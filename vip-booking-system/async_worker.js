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

function normalizeBookingPhoneForSheet_(value) {
  const text = String(value == null ? '' : value).trim().replace(/^'/, '');
  if (!text) return '';

  const digits = text.replace(/\D/g, '');
  if (digits.length === 9 && digits.charAt(0) === '9') return '0' + digits;
  if (digits.length === 10 && digits.indexOf('09') === 0) return digits;
  return text;
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

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = getBookingCustomerListColumnMap_(headers);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  rows.forEach(row => {
    const id = row[col.id];
    if (!id) return;
    customers[String(id)] = {
      id: id,
      name: row[col.name] || '',
      phone: normalizeBookingPhoneForSheet_(row[col.phone]),
      lineId: row[col.lineId] == null ? '' : String(row[col.lineId]).trim(),
      source: row[col.source] == null ? '' : String(row[col.source]).trim()
    };
  });
  return customers;
}

function getBookingCustomerListColumnMap_(headers) {
  const indexOfAny = (names, fallback) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1) return index;
    }
    return fallback;
  };

  return {
    id: indexOfAny(['客戶編號', 'ID'], 0),
    name: indexOfAny(['客戶稱呼', '姓名'], 1),
    phone: indexOfAny(['電話'], 2),
    lineId: indexOfAny(['Line ID', 'LineID'], 3),
    birthMonth: indexOfAny(['生日月份'], 4),
    status: indexOfAny(['狀態'], 5),
    createdAt: indexOfAny(['建立日期', '註冊時間'], 6),
    source: indexOfAny(['來源'], 7),
    note: indexOfAny(['備註'], 8)
  };
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
      durationMinutes: parseBookingNumber_(row[3]),
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

function findSingleBookingServiceItemForRecord_(durationMinutes, courses) {
  const duration = parseBookingNumber_(durationMinutes);
  const baseDuration = duration >= 100 ? 50 : duration;
  const seen = {};

  for (let key in courses) {
    const course = courses[key];
    if (!course || !course.name || seen[course.name]) continue;
    seen[course.name] = true;

    const courseType = String(course.courseType || '').trim();
    const courseDuration = parseBookingNumber_(course.durationMinutes);
    if (course.isActive === '是' && courseType.indexOf('單次') !== -1 && courseDuration === baseDuration) {
      return course.name;
    }
  }

  return '';
}

function resolveBookingServiceItemForRecordData_(d, courseName, planContent, courses) {
  const serviceItem = resolveBookingServiceItemForRecord_(courseName, planContent, courses);
  if (serviceItem) return serviceItem;
  if (d && d.plan === 'SINGLE') {
    return findSingleBookingServiceItemForRecord_(
      d.serviceDuration != null ? d.serviceDuration : d.duration,
      courses
    );
  }
  return '';
}

function getBookingRecordSheet_(ss) {
  let sheet = ss.getSheetByName(BOOKING_RECORD_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BOOKING_RECORD_SHEET_NAME);
    sheet.appendRow(BOOKING_RECORD_HEADERS);
  }
  sheet.getRange('D:D').setNumberFormat('@');
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
  const serviceItem = resolveBookingServiceItemForRecordData_(d, courseName, planContent, courses);
  const row = new Array(BOOKING_RECORD_TOTAL_COLUMNS).fill('');

  row[BOOKING_RECORD_COLUMN.CUSTOMER_NAME] = d.name || '';
  row[BOOKING_RECORD_COLUMN.PHONE] = normalizeBookingPhoneForSheet_(d.phone);
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
  row[BOOKING_RECORD_COLUMN.SYNC_STATUS] = '待同步';
  row[BOOKING_RECORD_COLUMN.SYNC_MESSAGE] = 'LIFF 建立預約，等待 Sheet Calendar 同步';
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
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.SYNC_STATUS + 1).setValue('待同步');
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.SYNC_MESSAGE + 1).setValue('LIFF 取消預約，準備立即同步 Google Calendar');
}

function getBookingSyncTimestampForRecord_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

function writeBookingSyncResultForRecord_(sheet, rowNumber, result) {
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.CALENDAR_EVENT_ID + 1, 1, 4).setValues([[
    result.calendarEventId || '',
    result.syncStatus || '',
    result.lastSyncedAt || getBookingSyncTimestampForRecord_(),
    result.syncMessage || ''
  ]]);
}

function combineBookingDateTimeForRecord_(dateValue, timeValue) {
  let year, month, day;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    year = dateValue.getFullYear();
    month = dateValue.getMonth();
    day = dateValue.getDate();
  } else {
    const dateText = String(dateValue == null ? '' : dateValue).trim();
    const dateMatch = dateText.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!dateMatch) return null;
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]) - 1;
    day = Number(dateMatch[3]);
  }

  let hours, minutes;
  if (timeValue instanceof Date && !isNaN(timeValue.getTime())) {
    hours = timeValue.getHours();
    minutes = timeValue.getMinutes();
  } else if (typeof timeValue === 'number') {
    const totalMinutes = Math.round(timeValue * 24 * 60);
    hours = Math.floor(totalMinutes / 60) % 24;
    minutes = totalMinutes % 60;
  } else {
    const timeText = String(timeValue == null ? '' : timeValue).trim();
    const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
    if (!timeMatch) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
  }

  return new Date(year, month, day, hours, minutes, 0);
}

function buildBookingCalendarDescriptionForRecord_(booking) {
  return [
    `預約編號：${booking.bookingId || ''}`,
    `客戶編號：${booking.customerId || ''}`,
    `客戶姓名：${booking.customerName || ''}`,
    `電話：${booking.phone || ''}`,
    `Line ID：${booking.lineId || ''}`,
    `服務項目：${booking.serviceItem || ''}`,
    `教練名稱：${booking.coachName || ''}`,
    `預約狀態：${booking.bookingStatus || ''}`,
    `付款狀態：${booking.paymentStatus || ''}`,
    `扣抵類型：${booking.offsetType || ''}`,
    `課程類型：${booking.courseType || ''}`,
    `是否需扣堂：${booking.shouldDeductClass || ''}`,
    `客戶來源：${booking.customerSource || ''}`,
    `備註：${booking.note || ''}`
  ].join('\n');
}

function buildBookingCalendarTitleForRecord_(booking) {
  const duration = parseBookingNumber_(booking.durationMinutes);
  const durationText = duration ? ` (${duration}分)` : '';
  const customerText = booking.customerName || booking.customerId || '';
  const serviceText = booking.serviceItem || '未設定服務項目';
  return `[預約] ${customerText} - ${serviceText}${durationText}`;
}

function findCalendarEventForRecord_(eventId) {
  if (!eventId || !CALENDAR_ID) return null;
  try {
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    return calendar ? calendar.getEventById(eventId) : null;
  } catch (error) {
    return null;
  }
}

function checkCalendarConflictForRecord_(calendar, startAt, endAt, excludeEventId) {
  const normalizedExcludeId = String(excludeEventId || '').trim();
  const events = calendar.getEvents(startAt, endAt);
  return events.find(event => {
    const eventId = String(event.getId() || '').trim();
    if (normalizedExcludeId && eventId === normalizedExcludeId) return false;
    return event.getStartTime() < endAt && event.getEndTime() > startAt;
  }) || null;
}

function syncBookingCalendarRow_(sheet, rowNumber, ss) {
  const row = sheet.getRange(rowNumber, 1, 1, BOOKING_RECORD_TOTAL_COLUMNS).getValues()[0];
  const displayRow = sheet.getRange(rowNumber, 1, 1, BOOKING_RECORD_TOTAL_COLUMNS).getDisplayValues()[0];
  if (displayRow[BOOKING_RECORD_COLUMN.START_TIME]) {
    row[BOOKING_RECORD_COLUMN.START_TIME] = displayRow[BOOKING_RECORD_COLUMN.START_TIME];
  }

  const booking = {
    bookingId: row[BOOKING_RECORD_COLUMN.BOOKING_ID],
    customerId: row[BOOKING_RECORD_COLUMN.CUSTOMER_ID],
    customerName: row[BOOKING_RECORD_COLUMN.CUSTOMER_NAME],
    phone: row[BOOKING_RECORD_COLUMN.PHONE],
    lineId: row[BOOKING_RECORD_COLUMN.LINE_ID],
    bookingDate: row[BOOKING_RECORD_COLUMN.BOOKING_DATE],
    startTime: row[BOOKING_RECORD_COLUMN.START_TIME],
    courseDeduction: row[BOOKING_RECORD_COLUMN.COURSE_DEDUCTION],
    singleBooking: row[BOOKING_RECORD_COLUMN.SINGLE_BOOKING],
    extraTicket: row[BOOKING_RECORD_COLUMN.EXTRA_TICKET],
    durationMinutes: row[BOOKING_RECORD_COLUMN.DURATION_MINUTES],
    serviceItem: row[BOOKING_RECORD_COLUMN.SERVICE_ITEM],
    coachName: row[BOOKING_RECORD_COLUMN.COACH_NAME],
    bookingStatus: String(row[BOOKING_RECORD_COLUMN.BOOKING_STATUS] || '').trim(),
    paymentStatus: row[BOOKING_RECORD_COLUMN.PAYMENT_STATUS],
    offsetType: row[BOOKING_RECORD_COLUMN.OFFSET_TYPE],
    courseType: row[BOOKING_RECORD_COLUMN.COURSE_TYPE],
    shouldDeductClass: row[BOOKING_RECORD_COLUMN.SHOULD_DEDUCT_CLASS],
    customerSource: row[BOOKING_RECORD_COLUMN.CUSTOMER_SOURCE],
    note: row[BOOKING_RECORD_COLUMN.NOTE],
    calendarEventId: row[BOOKING_RECORD_COLUMN.CALENDAR_EVENT_ID]
  };

  if (!CALENDAR_ID) {
    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: booking.calendarEventId,
      syncStatus: '設定缺失',
      syncMessage: '缺少 CALENDAR_ID，無法立即同步 Google Calendar'
    });
    return;
  }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: booking.calendarEventId,
      syncStatus: '設定缺失',
      syncMessage: '找不到 CALENDAR_ID 對應的 Google Calendar'
    });
    return;
  }

  if (booking.bookingStatus === '已取消') {
    try {
      const event = findCalendarEventForRecord_(booking.calendarEventId);
      if (event) event.deleteEvent();
      writeBookingSyncResultForRecord_(sheet, rowNumber, {
        calendarEventId: '',
        syncStatus: '已取消',
        syncMessage: event ? '已立即取消 Google Calendar 預約' : '已標記取消；找不到既有 Calendar 預約'
      });
    } catch (error) {
      writeBookingSyncResultForRecord_(sheet, rowNumber, {
        calendarEventId: booking.calendarEventId,
        syncStatus: '同步失敗',
        syncMessage: error && error.message ? error.message : 'Google Calendar 取消失敗'
      });
    }
    return;
  }

  const activeStatuses = ['已預約', '已確認', '已完成'];
  if (activeStatuses.indexOf(booking.bookingStatus) === -1) {
    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: booking.calendarEventId,
      syncStatus: '略過',
      syncMessage: '預約狀態未達同步條件'
    });
    return;
  }

  const startAt = combineBookingDateTimeForRecord_(booking.bookingDate, booking.startTime);
  const duration = parseBookingNumber_(booking.durationMinutes);
  const endAt = startAt && duration > 0 ? new Date(startAt.getTime() + duration * 60 * 1000) : null;
  const missingFields = [];
  if (!booking.customerName && !booking.customerId) missingFields.push('客戶姓名');
  if (!booking.serviceItem) missingFields.push('服務項目');
  if (!startAt) missingFields.push('預約日期/開始時間');
  if (!endAt) missingFields.push('時長');
  if (missingFields.length > 0) {
    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: booking.calendarEventId,
      syncStatus: '資料不足',
      syncMessage: `缺少欄位：${missingFields.join('、')}`
    });
    return;
  }

  try {
    const conflict = checkCalendarConflictForRecord_(calendar, startAt, endAt, booking.calendarEventId);
    if (conflict) {
      writeBookingSyncResultForRecord_(sheet, rowNumber, {
        calendarEventId: booking.calendarEventId,
        syncStatus: '時段衝突',
        syncMessage: `時段衝突：${conflict.getTitle() || '既有預約'}`
      });
      return;
    }

    const title = buildBookingCalendarTitleForRecord_(booking);
    const description = buildBookingCalendarDescriptionForRecord_(booking);
    let event = findCalendarEventForRecord_(booking.calendarEventId);
    if (event) {
      event.setTitle(title);
      event.setDescription(description);
      event.setTime(startAt, endAt);
    } else {
      event = calendar.createEvent(title, startAt, endAt, { description });
    }

    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: event.getId(),
      syncStatus: '已同步',
      syncMessage: 'Google Calendar 已立即同步成功'
    });
  } catch (error) {
    writeBookingSyncResultForRecord_(sheet, rowNumber, {
      calendarEventId: booking.calendarEventId,
      syncStatus: '同步失敗',
      syncMessage: error && error.message ? error.message : 'Google Calendar 同步失敗'
    });
  }
}

function syncBookingRecordWithSheetWorkflow_(ss, sheet, rowNumber) {
  if (typeof syncBookingRow_ === 'function') {
    const customers = typeof getCustomerDirectory_ === 'function' ? getCustomerDirectory_(ss) : getBookingCustomerDirectory_(ss);
    const courses = typeof getCourseSettingsDirectory_ === 'function' ? getCourseSettingsDirectory_(ss) : getBookingCourseDirectory_(ss);
    syncBookingRow_(sheet, rowNumber, customers, courses);
  }

  if (typeof syncBookingCalendarRow_ === 'function') {
    syncBookingCalendarRow_(sheet, rowNumber, ss);
    if (typeof refreshCalendarCache === 'function') refreshCalendarCache();
    return true;
  }

  return false;
}

function writeBookingRecordRow_(d, status) {
  const payload = buildBookingRecordRow_(d, status);
  const sheet = getBookingRecordSheet_(payload.ss);

  if (normalizeBookingStatusForRecord_(status) === '已取消') {
    const existingRow = findExistingBookingRecordRow_(sheet, payload.row);
    if (existingRow) {
      writeBookingCancellationResult_(sheet, existingRow);
      syncBookingRecordWithSheetWorkflow_(payload.ss, sheet, existingRow);
      return existingRow;
    }
  }

  sheet.appendRow(payload.row);
  const rowNumber = sheet.getLastRow();
  sheet.getRange(rowNumber, BOOKING_RECORD_COLUMN.PHONE + 1)
    .setNumberFormat('@')
    .setValue(payload.row[BOOKING_RECORD_COLUMN.PHONE]);
  syncBookingRecordWithSheetWorkflow_(payload.ss, sheet, rowNumber);
  return rowNumber;
}

function ensureCancelNotificationMessages_(d) {
  if (!d.adminMsg) {
    d.adminMsg = `❌ 【取消通知】\n🔹 姓名｜ ${d.name || ''}\n🔹 課程｜ ${d.realCourseName || ''}\n🔹 方案｜ ${d.customPlanName || ''}\n🔹 時間｜ ${d.dateTimeStr || ''}`;
  }

  if (!d.userMsg) {
    d.userMsg = `您好 ${d.name || ''}，您的預約已取消成功。\n📅 詳情：\n🔹 課程｜ ${d.realCourseName || ''}\n🔹 時間｜ ${d.dateTimeStr || ''}`;
  }
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
        }
      } catch (taskError) {
        console.error(`⚠️ 任務執行失敗 (${task.func}): ` + taskError.toString());
      }
    }
    console.log("✅ 所有任務執行完畢");
  }
}

function doProcessCreateLogAndNotify(d) {
  if (!d.bookingRecordWritten) writeBookingRecordRow_(d, '預約成功');

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
  ensureCancelNotificationMessages_(d);
  if (!d.bookingRecordWritten) writeBookingRecordRow_(d, '已取消');

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
