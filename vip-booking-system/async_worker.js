// ================= 背景工作處理 (AsyncWorker v8.2.0 Early Unlock) =================

const QUEUE_CACHE_KEY = 'SYSTEM_TASK_QUEUE';
const BOOKING_RECORD_SHEET_NAME = '預約紀錄';
const BOOKING_RECORD_TOTAL_COLUMNS = 27;
const DEFAULT_BOOKING_COACH_NAME = 'Graysen';

const BOOKING_RECORD_COLUMN = {
  BOOKING_ID: 0,
  CUSTOMER_ID: 1,
  CUSTOMER_NAME: 2,
  PHONE: 3,
  LINE_ID: 4,
  BOOKING_DATE: 5,
  START_TIME: 6,
  COURSE_DEDUCTION: 7,
  SINGLE_BOOKING: 8,
  EXTRA_TICKET: 9,
  DURATION_MINUTES: 10,
  SERVICE_ITEM: 11,
  COACH_NAME: 12,
  BOOKING_STATUS: 13,
  PAYMENT_STATUS: 14,
  OFFSET_TYPE: 15,
  COURSE_TYPE: 16,
  SHOULD_DEDUCT_CLASS: 17,
  CUSTOMER_SOURCE: 18,
  CREATED_AT: 19,
  UPDATED_AT: 20,
  NOTE: 21,
  CALENDAR_EVENT_ID: 22,
  SYNC_STATUS: 23,
  LAST_SYNCED_AT: 24,
  SYNC_MESSAGE: 25,
  SOURCE_CHANNEL: 26
};

const BOOKING_RECORD_HEADERS = [
  '預約編號',
  '客戶編號',
  '客戶姓名',
  '電話',
  'Line ID',
  '預約日期',
  '開始時間',
  '課程扣抵',
  '單次預約',
  '加時券',
  '時長',
  '服務項目',
  '教練名稱',
  '預約狀態',
  '付款狀態',
  '扣抵類型',
  '課程類型',
  '是否需扣堂',
  '客戶來源',
  '建立時間',
  '更新時間',
  '備註',
  'Calendar Event ID',
  '同步狀態',
  '最後同步時間',
  '同步訊息',
  '來源渠道'
];

function parseBookingNumber_(value) {
  if (typeof value === 'number') return value;
  const text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function normalizeBookingLookupKey_(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/^'/, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeBookingDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return {
      date: value,
      time: Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm')
    };
  }

  const text = String(value == null ? '' : value).trim();
  if (!text) return { date: '', time: '' };

  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!match) return { date: text, time: '' };

  return {
    date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    time: String(match[4]).padStart(2, '0') + ':' + match[5]
  };
}

function formatBookingDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return match
    ? match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0')
    : text;
}

function formatBookingTimeKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }

  const text = String(value == null ? '' : value).trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? String(match[1]).padStart(2, '0') + ':' + match[2] : text;
}

function normalizeBookingStatusForRecord_(value) {
  const status = String(value == null ? '' : value).trim();
  if (!status) return '';
  if (status === '預約成功') return '已預約';
  if (status.indexOf('取消') !== -1) return '已取消';
  return status;
}

function inferBookingOffsetTypeForRecord_(courseDeduction, singleBooking, extraTicket, planContent) {
  const courseCount = parseBookingNumber_(courseDeduction);
  const singleCount = parseBookingNumber_(singleBooking);
  const extraCount = parseBookingNumber_(extraTicket);
  const planText = String(planContent || '');

  if (singleCount > 0) return '無';
  if (courseCount > 0 && extraCount > 0) return '課程扣堂+加時券扣堂';
  if (extraCount > 0) return '加時券扣堂';
  if (courseCount > 0 || planText.indexOf('課程扣抵') !== -1) return '課程扣堂';
  return '無';
}

function getBookingCustomerDirectory_(ss) {
  const sheet = ss.getSheetByName('客戶名單');
  const customers = {};
  if (!sheet || sheet.getLastRow() < 2) return customers;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  rows.forEach(row => {
    const id = row[0];
    if (!id) return;
    customers[String(id)] = {
      id: id,
      name: row[1] || '',
      phone: row[2] == null ? '' : String(row[2]).replace(/^'/, '').trim(),
      lineId: row[3] == null ? '' : String(row[3]).trim(),
      source: row[6] == null ? '' : String(row[6]).trim()
    };
  });
  return customers;
}

function findBookingCustomerForRecord_(bookingRow, customers) {
  const lineId = normalizeBookingLookupKey_(bookingRow[BOOKING_RECORD_COLUMN.LINE_ID]);
  const phone = normalizeBookingLookupKey_(bookingRow[BOOKING_RECORD_COLUMN.PHONE]);
  const name = normalizeBookingLookupKey_(bookingRow[BOOKING_RECORD_COLUMN.CUSTOMER_NAME]);

  for (let id in customers) {
    const customer = customers[id];
    if (lineId && normalizeBookingLookupKey_(customer.lineId) === lineId) return customer;
    if (phone && normalizeBookingLookupKey_(customer.phone) === phone) return customer;
  }

  if (!name) return null;
  const nameMatches = Object.keys(customers)
    .map(id => customers[id])
    .filter(customer => normalizeBookingLookupKey_(customer.name) === name);
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function getBookingCourseDirectory_(ss) {
  const sheet = ss.getSheetByName('課程名稱設定');
  const courses = {};
  if (!sheet || sheet.getLastRow() < 2) return courses;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 15).getValues();
  rows.forEach(row => {
    const course = {
      code: row[0] || '',
      name: row[1] || '',
      officialCourseName: row[2] || row[1] || '',
      courseType: row[5] || '',
      shouldDeductClass: row[6] || '',
      mappedCourseName: row[12] || '',
      isActive: String(row[13] == null ? '' : row[13]).trim()
    };
    if (!course.code && !course.name && !course.officialCourseName) return;

    [
      course.code,
      course.name,
      course.officialCourseName,
      course.mappedCourseName
    ].forEach(keyValue => {
      const key = normalizeBookingLookupKey_(keyValue);
      if (key && (!courses[key] || courses[key].isActive !== '是')) courses[key] = course;
    });
  });
  return courses;
}

function resolveBookingServiceItemForRecord_(courseName, planContent, courses) {
  const keys = [
    normalizeBookingLookupKey_(courseName),
    normalizeBookingLookupKey_(planContent)
  ].filter(Boolean);

  for (let i = 0; i < keys.length; i++) {
    const course = courses[keys[i]];
    if (course && course.name) return course.name;
  }
  return '';
}

function getBookingRecordSheet_(ss) {
  let sheet = ss.getSheetByName(BOOKING_RECORD_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BOOKING_RECORD_SHEET_NAME);
    sheet.appendRow(BOOKING_RECORD_HEADERS);
  }
  return sheet;
}

function buildBookingRecordRow_(d, status) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const customers = getBookingCustomerDirectory_(ss);
  const courses = getBookingCourseDirectory_(ss);
  const bookingDateTime = normalizeBookingDateTime_(d.dateTime || d.dateTimeStr);
  const courseDeduction = parseBookingNumber_(d.courseDeduction != null ? d.courseDeduction : (d.plan === 'COURSE' ? 1 : 0));
  const singleBooking = parseBookingNumber_(d.singleCount != null ? d.singleCount : (d.plan === 'SINGLE' ? 1 : 0));
  const extraTicket = parseBookingNumber_(d.ticketVal != null ? d.ticketVal : (d.useTicket ? 1 : 0));
  const durationMinutes = parseBookingNumber_(d.serviceDuration != null ? d.serviceDuration : d.duration);
  const planContent = d.planContent || d.customPlanName || '';
  const courseName = d.courseName || d.realCourseName || '';
  const serviceItem = resolveBookingServiceItemForRecord_(courseName, planContent, courses);
  const row = new Array(BOOKING_RECORD_TOTAL_COLUMNS).fill('');

  row[BOOKING_RECORD_COLUMN.CUSTOMER_NAME] = d.name || '';
  row[BOOKING_RECORD_COLUMN.PHONE] = d.phone == null ? '' : String(d.phone).replace(/^'/, '').trim();
  row[BOOKING_RECORD_COLUMN.LINE_ID] = d.lineUserId || '';
  row[BOOKING_RECORD_COLUMN.BOOKING_DATE] = bookingDateTime.date;
  row[BOOKING_RECORD_COLUMN.START_TIME] = bookingDateTime.time;
  row[BOOKING_RECORD_COLUMN.COURSE_DEDUCTION] = courseDeduction;
  row[BOOKING_RECORD_COLUMN.SINGLE_BOOKING] = singleBooking;
  row[BOOKING_RECORD_COLUMN.EXTRA_TICKET] = extraTicket;
  row[BOOKING_RECORD_COLUMN.DURATION_MINUTES] = durationMinutes;
  row[BOOKING_RECORD_COLUMN.SERVICE_ITEM] = serviceItem;
  row[BOOKING_RECORD_COLUMN.COACH_NAME] = DEFAULT_BOOKING_COACH_NAME;
  row[BOOKING_RECORD_COLUMN.BOOKING_STATUS] = normalizeBookingStatusForRecord_(status);
  row[BOOKING_RECORD_COLUMN.PAYMENT_STATUS] = singleBooking > 0 && status !== '已取消' ? '未付款' : '';
  row[BOOKING_RECORD_COLUMN.OFFSET_TYPE] = inferBookingOffsetTypeForRecord_(courseDeduction, singleBooking, extraTicket, planContent);
  row[BOOKING_RECORD_COLUMN.CREATED_AT] = new Date();
  row[BOOKING_RECORD_COLUMN.NOTE] = d.note || '';
  row[BOOKING_RECORD_COLUMN.SOURCE_CHANNEL] = 'LIFF';

  const customer = findBookingCustomerForRecord_(row, customers);
  if (customer) {
    row[BOOKING_RECORD_COLUMN.CUSTOMER_ID] = customer.id || '';
    row[BOOKING_RECORD_COLUMN.CUSTOMER_NAME] = customer.name || row[BOOKING_RECORD_COLUMN.CUSTOMER_NAME];
    row[BOOKING_RECORD_COLUMN.PHONE] = customer.phone || row[BOOKING_RECORD_COLUMN.PHONE];
    row[BOOKING_RECORD_COLUMN.LINE_ID] = customer.lineId || row[BOOKING_RECORD_COLUMN.LINE_ID];
    row[BOOKING_RECORD_COLUMN.CUSTOMER_SOURCE] = customer.source || '';
  }

  const course = courses[normalizeBookingLookupKey_(serviceItem)];
  if (course) {
    row[BOOKING_RECORD_COLUMN.COURSE_TYPE] = course.courseType || '';
    row[BOOKING_RECORD_COLUMN.SHOULD_DEDUCT_CLASS] = course.shouldDeductClass || '';
  }

  return { ss: ss, row: row };
}

function findExistingBookingRecordRow_(sheet, bookingRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const targetPhone = normalizeBookingLookupKey_(bookingRow[BOOKING_RECORD_COLUMN.PHONE]);
  const targetLineId = normalizeBookingLookupKey_(bookingRow[BOOKING_RECORD_COLUMN.LINE_ID]);
  const targetDate = formatBookingDateKey_(bookingRow[BOOKING_RECORD_COLUMN.BOOKING_DATE]);
  const targetTime = formatBookingTimeKey_(bookingRow[BOOKING_RECORD_COLUMN.START_TIME]);
  if (!targetDate || !targetTime || (!targetPhone && !targetLineId)) return 0;

  const rowCount = lastRow - 1;
  const firstColumn = BOOKING_RECORD_COLUMN.PHONE + 1;
  const columnCount = BOOKING_RECORD_COLUMN.BOOKING_STATUS - BOOKING_RECORD_COLUMN.PHONE + 1;
  const values = sheet.getRange(2, firstColumn, rowCount, columnCount).getValues();
  const displays = sheet.getRange(2, firstColumn, rowCount, columnCount).getDisplayValues();
  const phoneIndex = BOOKING_RECORD_COLUMN.PHONE - BOOKING_RECORD_COLUMN.PHONE;
  const lineIdIndex = BOOKING_RECORD_COLUMN.LINE_ID - BOOKING_RECORD_COLUMN.PHONE;
  const dateIndex = BOOKING_RECORD_COLUMN.BOOKING_DATE - BOOKING_RECORD_COLUMN.PHONE;
  const timeIndex = BOOKING_RECORD_COLUMN.START_TIME - BOOKING_RECORD_COLUMN.PHONE;
  const statusIndex = BOOKING_RECORD_COLUMN.BOOKING_STATUS - BOOKING_RECORD_COLUMN.PHONE;

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const displayRow = displays[i];
    const rowStatus = String(row[statusIndex] || '').trim();
    if (rowStatus === '已取消') continue;

    const rowPhone = normalizeBookingLookupKey_(row[phoneIndex]);
    const rowLineId = normalizeBookingLookupKey_(row[lineIdIndex]);
    const sameCustomer =
      (targetPhone && rowPhone === targetPhone) ||
      (targetLineId && rowLineId === targetLineId);
    if (!sameCustomer) continue;

    const rowDate = formatBookingDateKey_(row[dateIndex] || displayRow[dateIndex]);
    const rowTime = formatBookingTimeKey_(displayRow[timeIndex] || row[timeIndex]);
    if (rowDate === targetDate && rowTime === targetTime) return i + 2;
  }

  return 0;
}

function writeBookingCancellationResult_(sheet, rowNumber) {
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.BOOKING_STATUS + 1).setValue('已取消');
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.UPDATED_AT + 1).setValue(new Date());
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.SYNC_STATUS + 1).setValue('已取消');
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.SYNC_MESSAGE + 1).setValue('LIFF 取消預約');
}

function writeBookingRecordRow_(d, status) {
  const payload = buildBookingRecordRow_(d, status);
  const sheet = getBookingRecordSheet_(payload.ss);

  if (normalizeBookingStatusForRecord_(status) === '已取消') {
    const existingRow = findExistingBookingRecordRow_(sheet, payload.row);
    if (existingRow) {
      writeBookingCancellationResult_(sheet, existingRow);
      return existingRow;
    }
  }

  sheet.appendRow(payload.row);
  return sheet.getLastRow();
}

/**
 * [前端呼叫] 將任務加入佇列 (維持不變)
 */
function addTaskToQueue(functionName, data) {
  const lock = LockService.getScriptLock();
  if (lock.tryLock(2000)) {
    try {
      const cache = CacheService.getScriptCache();
      const queueJson = cache.get(QUEUE_CACHE_KEY);
      let queue = queueJson ? JSON.parse(queueJson) : [];
      
      queue.push({ func: functionName, data: data, time: new Date().getTime() });
      cache.put(QUEUE_CACHE_KEY, JSON.stringify(queue), 21600);
      console.log(`⚡️ [佇列] 任務已加入 (目前堆積: ${queue.length} 筆)`);
    } catch (e) {
      console.error("❌ 加入佇列失敗: " + e.toString());
    } finally {
      lock.releaseLock();
    }
  }
}
/**
 * [背景排程] 消化佇列中的任務 (關鍵優化：快速釋放鎖)
 */
function processTaskQueue() {
  const lock = LockService.getScriptLock();
  let queueToProcess = []; // 用來暫存取出的任務

  // 1. 【快速階段】獲取鎖，只做「取出」和「清空」的動作
  if (lock.tryLock(5000)) {
    try {
      const cache = CacheService.getScriptCache();
      const queueJson = cache.get(QUEUE_CACHE_KEY);
      
      if (queueJson) {
        const queue = JSON.parse(queueJson);
        if (queue.length > 0) {
          // 把任務複製出來
          queueToProcess = queue;
          
          // 立刻清空快取中的佇列
          cache.remove(QUEUE_CACHE_KEY);
          console.log(`🔄 [排程] 取出 ${queue.length} 筆任務，準備執行...`);
        }
      }
    } catch (e) {
      console.error("❌ 讀取佇列錯誤: " + e.toString());
    } finally {
      // ▼▼▼ 關鍵！拿到資料後立刻釋放鎖！ ▼▼▼
      // 這樣前端的 createBooking 就不會被卡住，可以馬上寫入新任務
      lock.releaseLock(); 
    }
  }

  // 2. 【慢速階段】在沒有鎖的情況下，慢慢執行耗時任務 (IO)
  if (queueToProcess.length > 0) {
    for (const task of queueToProcess) {
      try {
        if (task.func === 'processCreateLogAndNotify') {
          doProcessCreateLogAndNotify(task.data);
          console.log("✅ processCreateLogAndNotify");
        } else if (task.func === 'processCancelLogAndNotify') {
          doProcessCancelLogAndNotify(task.data);
          console.log("✅ processCancelLogAndNotify");
        } else if (task.func === 'processCancelTask') {
          processCancelTask(task.data);
          console.log("✅ processCancelTask");
        } else if (task.func === 'processCreateEvent') {
          processCreateEvent(task.data);
          console.log("✅ processCreateEvent");
        }
      } catch (taskError) {
        console.error(`⚠️ 任務執行失敗 (${task.func}): ` + taskError.toString());
      }
    }
    console.log("✅ 所有任務執行完畢");
  }
}

function doProcessCreateLogAndNotify(d) {
  writeBookingRecordRow_(d, '預約成功');

  // --- LINE 通知發送 ---
  const requests = [];
  // 管理員通知
  requests.push({
    url: 'https://api.line.me/v2/bot/message/push',
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ to: ADMIN_LINE_ID, messages: [{ type: 'text', text: d.adminMsg }] }),
    muteHttpExceptions: true
  });

  // 使用者通知
  if (d.lineUserId && d.lineUserId.length > 10) {
    requests.push({
      url: 'https://api.line.me/v2/bot/message/push',
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ to: d.lineUserId, messages: [{ type: 'text', text: d.userMsg }] }),
      muteHttpExceptions: true
    });
  }

  // 執行非同步請求
  if (requests.length > 0) { 
    try { 
      //UrlFetchApp.fetchAll(requests); 
    } catch(e) { 
      console.error("LINE 發送失敗: " + e.toString()); 
    } 
  }
}

function doProcessCancelLogAndNotify(d) {
  writeBookingRecordRow_(d, '已取消');

  // --- LINE 訊息發送 ---
  const requests = [];
  requests.push({
     url: 'https://api.line.me/v2/bot/message/push',
     method: 'post',
     headers: { 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
     payload: JSON.stringify({ to: ADMIN_LINE_ID, messages: [{ type: 'text', text: d.adminMsg }] }),
     muteHttpExceptions: true
  });

  if (d.lineUserId && d.lineUserId.length > 10) {
    requests.push({
       url: 'https://api.line.me/v2/bot/message/push',
       method: 'post',
       headers: { 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
       payload: JSON.stringify({ to: d.lineUserId, messages: [{ type: 'text', text: d.userMsg }] }),
       muteHttpExceptions: true
    });
  }
  
 // if (requests.length > 0) UrlFetchApp.fetchAll(requests);
}
