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
  addTaskToQueue('processCreateLogAndNotify', notifyTaskData);

  console.log(`🏁 [createBooking] 處理完成，耗時: ${new Date().getTime() - tStart} ms`);
  return { success: true, eventId: tempId };
}

// ==========================================
// ➖ 取消預約 (參數完整封裝版)
// ==========================================
function cancelBooking(data) {
  try {
    // 1. 【樂觀刪除快取】
    removeEventFromCache(data.eventId, data.dateTimeStr, data.phone);

    // 2. 【分派任務】只更新預約紀錄；Calendar 交由 Sheet 同步邏輯處理
    addTaskToQueue('processCancelLogAndNotify', data);

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
