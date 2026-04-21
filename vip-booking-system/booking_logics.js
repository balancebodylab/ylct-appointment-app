// ==========================================
// 📅 預約交易邏輯 (BookingLogic v8.2 Final Stable)
// 更新日期：2026-03-21
// 更新重點：強化大禮包解析、對齊預約紀錄 Sheet、Calendar 交由 Sheet 同步
// ==========================================

// ==========================================
// ➕ 新增預約 (極速快取與非同步整合)
// ==========================================
function createBooking(date, time, duration, name, phone, lineUserId, plan, useTicket, customPlanName, realCourseName) {
  const tStart = new Date().getTime(); 
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);
    console.log('🔒 [createBooking] 已取得 ScriptLock');
  } catch (lockErr) {
    console.warn('⚠️ [createBooking] 取 lock 失敗：' + lockErr);
    return { success: false, error: '系統忙碌中，請稍後再試' };
  }

  try {
    // 1. 🔍 規範化名稱與方案
    let courseName = realCourseName || customPlanName || '一般預約'; 
    let planContent = customPlanName; 
    if (!planContent) {
      planContent = (plan === 'COURSE' ? '課程扣抵' : '單次預約');
      if (useTicket) planContent += " + 結構調整抵用卷";
    }

    const durationInt = parseInt(duration);
    // 核心邏輯：計算實際服務時間（扣除轉場時間）
    const serviceDuration = durationInt - (plan === 'COURSE' && planContent.includes('2堂') ? 20 : 10);
    if (plan === 'SINGLE') {
      courseName = planContent.indexOf('80') !== -1 ? '功能性運動按摩 80 分鐘' : '超人氣運動按摩 50 分鐘';
    }
    const ticketVal = useTicket ? 1 : 0;
    const weekday = getDayOfWeekCN(date);

    const start = new Date(date.replace(/-/g, '/') + ' ' + time + ':00'); 
    const end = new Date(start.getTime() + durationInt * 60000);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const cache = CacheService.getScriptCache();
    let cachedJson = cache.get(CACHE_KEY_CALENDAR);

    if (!cachedJson) {
      refreshCalendarCache();
      cachedJson = cache.get(CACHE_KEY_CALENDAR);
    }

    if (!cachedJson) {
      console.warn('⚠️ [createBooking] 快取為空，略過 lock 內衝突檢查');
    } else {
      const allEvents = JSON.parse(cachedJson);
      const busyRanges = allEvents
        .filter(e => (e.t || '').includes('[預約]'))
        .map(e => ({ start: new Date(e.s).getTime(), end: new Date(e.e).getTime() }));
      const hasConflict = busyRanges.some(r => startMs < r.end && endMs > r.start);

      if (hasConflict) {
        console.warn(`⚠️ [createBooking] 時段衝突，已拒絕預約：${date} ${time}`);
        return { success: false, error: '該時段剛被預約，請選其他時段' };
      }
    }

    // 🏷️ 日曆顯示標題
    const title = `[預約] ${name}`;
    
    // 📝 關鍵：描述欄位是系統的「唯一事實來源」，格式必須嚴格執行
    const descriptionContent = `方案內容：${planContent}\n` +
                               `課程名稱：${courseName}\n` +
                               `電話：${phone}\n` +
                               `LineID：${lineUserId}\n` +
                               `加時卷：${ticketVal}\n` +
                               `時間：${serviceDuration}`;

    // 💡 產生智慧 Temp ID
    const tempId = "temp_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);

    // --- 2. 樂觀更新快取 (前端秒看預約成功) ---
    addEventToCache(start, end, title, descriptionContent, tempId);

    // 🛠️ 準備預約紀錄 Sheet 資料
    const notifyTaskData = {
      lineUserId: lineUserId, 
      name: name, 
      phone: phone, 
      dateTime: date + ' ' + time,
      courseName: courseName, 
      planContent: planContent,
      courseDeduction: (plan === 'COURSE' ? 1 : 0),
      singleCount: (plan === 'SINGLE' ? 1 : 0),
      ticketVal: ticketVal,
      serviceDuration: serviceDuration,
      adminMsg: `🎉 預約成功通知\n\n🔹 姓名｜ ${name}\n🔹 聯絡電話｜ ${phone}\n🔹 課程方案｜ ${serviceDuration}分鐘 （${planContent}）\n🔹 確認時間｜ ${date} ${weekday} ${time}`,
      userMsg: `您好 ${name}，您的預約已成功！\n\n📅 詳情：\n🔹 姓名｜ ${name}\n🔹 課程｜ ${serviceDuration}分鐘（${planContent}）\n🔹 時間｜ ${date} ${weekday} ${time}\n\n期待您的光臨！`
    };
    notifyTaskData.bookingRecordRow = writeBookingRecordRow_(notifyTaskData, '預約成功');
    notifyTaskData.bookingRecordWritten = true;
    addTaskToQueue('processCreateLogAndNotify', notifyTaskData);

    console.log(`🏁 [createBooking] 處理完成，耗時: ${new Date().getTime() - tStart} ms`);
    return { success: true, eventId: tempId };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

// ==========================================
// ➖ 取消預約 (參數完整封裝版)
// ==========================================
function cancelBooking(data) {
  try {
    // 1. 【樂觀刪除快取】
    const removedFromCache = removeEventFromCache(data.eventId, data.dateTimeStr, data.phone);

    // 2. 立即更新預約紀錄與 Google Calendar，再把通知交給背景任務
    ensureCancelNotificationMessages_(data);
    data.bookingRecordRow = writeBookingRecordRow_(data, '已取消');
    data.bookingRecordWritten = true;
    addTaskToQueue('processCancelLogAndNotify', data);

    // 3. 保守刷新快取，避免前端下一次查詢仍拿到取消前的舊預約
    if (typeof refreshCalendarCacheAfterCancellation === 'function') {
      refreshCalendarCacheAfterCancellation();
    } else if (!removedFromCache && typeof invalidateCalendarCache === 'function') {
      invalidateCalendarCache();
    }

    return { success: true };
  } catch (e) {
    console.error("取消失敗: ", e);
    return { success: false, error: e.toString() };
  }
}

// ==========================================
// 🔍 查詢預約 (完整大禮包解析版)
// ==========================================
function getBookingHistory(phone) {
  if (!phone) return { success: false, error: '缺少電話號碼' };

  const sheetBookings = getBookingHistoryFromSheet_(phone);
  if (sheetBookings) return { success: true, bookings: sheetBookings };

  const cache = CacheService.getScriptCache();
  let cachedJson = cache.get(CACHE_KEY_CALENDAR);
  
  if (!cachedJson) {
    refreshCalendarCache();
    cachedJson = cache.get(CACHE_KEY_CALENDAR);
  }

  if (!cachedJson) return { success: true, bookings: [] };

  const allEvents = JSON.parse(cachedJson);
  const pad = (n) => n.toString().padStart(2, '0');

  // 過濾屬於該手機號碼的預約
  let myBookings = allEvents.filter(e => (e.t || '').includes('[預約]') && (e.d || '').includes(phone));

  const result = myBookings.map(e => {
    const start = new Date(e.s);
    const end = new Date(e.e);
    const desc = e.d || ''; 
    
    // 🧩 透過 Regex 完美還原「大禮包」
    // 考慮到最後一行可能沒有換行符，加上 (?:\n|$)
    const matchCourse = desc.match(/課程名稱：(.*?)(?:\n|$)/);
    const matchPlan = desc.match(/方案內容：(.*?)(?:\n|$)/);
    const matchDuration = desc.match(/時間：(\d+)/);
    const hasTicket = desc.includes("加時卷：1");

    const realCourseName = (matchCourse && matchCourse[1]) ? matchCourse[1].trim() : '一般課程';
    const customPlanName = (matchPlan && matchPlan[1]) ? matchPlan[1].trim() : '課程扣抵';
    const planType = customPlanName.includes('單次') ? 'SINGLE' : 'COURSE';

    return {
      id: e.i,
      title: realCourseName !== 'undefined' ? realCourseName : customPlanName, 
      start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`,
      end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
      // ⚡️ 傳回前端的大禮包屬性
      realCourseName: realCourseName,
      customPlanName: customPlanName,
      plan: planType,
      duration: matchDuration ? parseInt(matchDuration[1]) : 50,
      useTicket: hasTicket
    };
  });

  result.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { success: true, bookings: result };
}

function getBookingHistoryFromSheet_(phone) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(BOOKING_RECORD_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const targetPhone = normalizeBookingLookupKey_(normalizeBookingPhoneForSheet_(phone));
    if (!targetPhone) return [];

    const rowCount = sheet.getLastRow() - 1;
    const values = sheet.getRange(2, 1, rowCount, BOOKING_RECORD_TOTAL_COLUMNS).getValues();
    const displays = sheet.getRange(2, 1, rowCount, BOOKING_RECORD_TOTAL_COLUMNS).getDisplayValues();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const bookings = [];
    values.forEach((row, index) => {
      const displayRow = displays[index];
      const rowPhone = normalizeBookingLookupKey_(row[BOOKING_RECORD_COLUMN.PHONE] || displayRow[BOOKING_RECORD_COLUMN.PHONE]);
      const status = normalizeBookingStatusForRecord_(row[BOOKING_RECORD_COLUMN.BOOKING_STATUS] || displayRow[BOOKING_RECORD_COLUMN.BOOKING_STATUS]);
      if (rowPhone !== targetPhone || status === '已取消') return;

      const startAt = combineBookingDateTimeForRecord_(
        row[BOOKING_RECORD_COLUMN.BOOKING_DATE] || displayRow[BOOKING_RECORD_COLUMN.BOOKING_DATE],
        displayRow[BOOKING_RECORD_COLUMN.START_TIME] || row[BOOKING_RECORD_COLUMN.START_TIME]
      );
      if (!startAt || startAt < todayStart) return;

      const duration = parseBookingNumber_(row[BOOKING_RECORD_COLUMN.DURATION_MINUTES] || displayRow[BOOKING_RECORD_COLUMN.DURATION_MINUTES]) || 50;
      const endAt = new Date(startAt.getTime() + duration * 60000);
      const courseDeduction = parseBookingNumber_(row[BOOKING_RECORD_COLUMN.COURSE_DEDUCTION]);
      const singleBooking = parseBookingNumber_(row[BOOKING_RECORD_COLUMN.SINGLE_BOOKING]);
      const extraTicket = parseBookingNumber_(row[BOOKING_RECORD_COLUMN.EXTRA_TICKET]);
      const serviceItem = String(row[BOOKING_RECORD_COLUMN.SERVICE_ITEM] || displayRow[BOOKING_RECORD_COLUMN.SERVICE_ITEM] || '一般課程').trim();
      const planType = singleBooking > 0 ? 'SINGLE' : 'COURSE';
      const customPlanName = buildBookingPlanNameFromSheet_(courseDeduction, singleBooking, duration);

      bookings.push({
        id: String(row[BOOKING_RECORD_COLUMN.CALENDAR_EVENT_ID] || row[BOOKING_RECORD_COLUMN.BOOKING_ID] || ('record_' + (index + 2))),
        title: serviceItem,
        start: formatBookingDateTimeForHistory_(startAt),
        end: formatBookingTimeForHistory_(endAt),
        realCourseName: serviceItem,
        customPlanName: customPlanName,
        plan: planType,
        duration: duration,
        useTicket: extraTicket > 0
      });
    });

    bookings.sort((a, b) => new Date(a.start.replace(/-/g, '/')) - new Date(b.start.replace(/-/g, '/')));
    return bookings;
  } catch (e) {
    console.warn('⚠️ 從預約紀錄讀取預約失敗，改用 Calendar 快取: ' + e.toString());
    return null;
  }
}

function formatBookingDateTimeForHistory_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function formatBookingTimeForHistory_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm');
}

function buildBookingPlanNameFromSheet_(courseDeduction, singleBooking, duration) {
  if (singleBooking > 0) {
    return '單次預約 (' + duration + '分)';
  }
  if (courseDeduction > 1) {
    return '課程扣抵 (連續' + courseDeduction + '堂 ' + duration + '分)';
  }
  return '課程扣抵 (1堂 ' + duration + '分)';
}
