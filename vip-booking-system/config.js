// ================= 設定區 (Config) =================
const scriptProps = PropertiesService.getScriptProperties();

const CALENDAR_ID = scriptProps.getProperty('CALENDAR_ID');
const SHEET_ID = scriptProps.getProperty('SHEET_ID'); 
const LINE_ACCESS_TOKEN = scriptProps.getProperty('LINE_ACCESS_TOKEN');
const ADMIN_LINE_ID = scriptProps.getProperty('ADMIN_LINE_ID'); 
const APPOINTMENT_LOG = scriptProps.getProperty('APPOINTMENT_LOG');

const DAILY_BOOKING_LIMIT = 6; 
const MEAL_WINDOW_START = 16; 
const MEAL_WINDOW_END = 20;   
const MIN_MEAL_DURATION = 60; 
const BUFFER_MINUTES = 10;    // 預約後強制保留緩衝 (分鐘)

// 定義需保護的休息時段
const PROTECTION_WINDOWS = [
  // { type: 'LUNCH', start: 11, end: 14 }, 
  { type: 'DINNER', start: 17, end: 20 }    // 只保留晚餐時段 (17:00 - 20:00)
];