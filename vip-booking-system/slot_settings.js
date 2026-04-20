// ================= 預約時段設定 (SlotSettings) =================

const SLOT_SETTINGS_CACHE_TTL_SECONDS = 600;
const SLOT_SETTINGS_BUSINESS_CACHE_KEY = 'slot_settings_v1_business';
const SLOT_SETTINGS_MEAL_CACHE_KEY = 'slot_settings_v1_meal';
const SLOT_SETTINGS_SPECIAL_CACHE_KEY = 'slot_settings_v1_special';

const SLOT_SETTINGS_BUSINESS_SHEET = '預約時段設定';
const SLOT_SETTINGS_MEAL_SHEET = '餐保護視窗';
const SLOT_SETTINGS_SPECIAL_SHEET = '特殊時段規則';

function getBusinessHours(dayOfWeek) {
  const businessSettings = loadBusinessSettings_();
  return businessSettings[String(dayOfWeek)] || getFallbackBusinessHours_(dayOfWeek);
}

function getProtectionWindows(dayOfWeek) {
  const mealSettings = loadMealSettings_();
  return mealSettings[String(dayOfWeek)] || [];
}

function getSpecialRules(dayOfWeek, durationMinutes) {
  const specialSettings = loadSpecialRules_();
  const dayRules = specialSettings[String(dayOfWeek)] || [];
  const duration = parseInt(durationMinutes, 10);
  return dayRules.filter(rule => rule.durationMinutes === duration).map(rule => ({
    type: rule.type,
    triggerCondition: rule.triggerCondition,
    openSlot: rule.openSlot
  }));
}

function refreshSlotSettings() {
  const cache = CacheService.getScriptCache();
  cache.remove(SLOT_SETTINGS_BUSINESS_CACHE_KEY);
  cache.remove(SLOT_SETTINGS_MEAL_CACHE_KEY);
  cache.remove(SLOT_SETTINGS_SPECIAL_CACHE_KEY);
  Logger.log('預約時段設定快取已清除');
}

function initSlotSettingSheets() {
  const spreadsheet = getSlotSettingsSpreadsheet_();
  ensureSlotSettingSheet_(
    spreadsheet,
    SLOT_SETTINGS_MEAL_SHEET,
    ['開始時刻', '結束時刻', '最短空檔(分鐘)', '適用星期', '備註'],
    [
      ['11:00', '13:00', 60, '一', '週一午餐'],
      ['16:30', '18:30', 60, '二,三,四,五,六', '平日晚餐']
    ]
  );
  ensureSlotSettingSheet_(
    spreadsheet,
    SLOT_SETTINGS_SPECIAL_SHEET,
    ['類型', '適用星期', '課長(分鐘)', '觸發條件', '開放時段', '備註'],
    [
      ['早鳥', '二,三,四,五,六', 80, '當日15:00已被預約', '13:30', ''],
      ['夜場', '一,二,三,四,五,六,日', 80, '無', '21:00', '允許超出營業結束時間']
    ]
  );
}

function loadBusinessSettings_() {
  return loadSlotSettingCache_(SLOT_SETTINGS_BUSINESS_CACHE_KEY, readBusinessSettings_, getFallbackBusinessSettings_());
}

function loadMealSettings_() {
  return loadSlotSettingCache_(SLOT_SETTINGS_MEAL_CACHE_KEY, readMealSettings_, getFallbackMealSettings_());
}

function loadSpecialRules_() {
  return loadSlotSettingCache_(SLOT_SETTINGS_SPECIAL_CACHE_KEY, readSpecialRules_, getFallbackSpecialRules_());
}

function loadSlotSettingCache_(cacheKey, reader, fallbackValue) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const value = reader();
    cache.put(cacheKey, JSON.stringify(value), SLOT_SETTINGS_CACHE_TTL_SECONDS);
    return value;
  } catch (error) {
    Logger.log(`讀取預約時段設定失敗，使用預設值：${error && error.message ? error.message : error}`);
    return fallbackValue;
  }
}

function readBusinessSettings_() {
  const sheet = getRequiredSlotSettingsSheet_(SLOT_SETTINGS_BUSINESS_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0] || [];
  const idx = buildHeaderIndex_(headers);
  const settings = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const days = parseWeekdaySet_(row[idx['星期']]);
    const start = parseTimeParts_(row[idx['營業開始時間']]);
    const end = parseTimeParts_(row[idx['營業結束時間']]);
    if (!days.size || !start || !end) continue;

    const isOpen = parseOpenValue_(row[idx['是否開放']]);
    days.forEach(day => {
      settings[String(day)] = {
        startH: start.hour,
        endH: end.hour,
        isOpen: isOpen
      };
    });
  }

  return Object.keys(settings).length ? settings : getFallbackBusinessSettings_();
}

function readMealSettings_() {
  const sheet = getRequiredSlotSettingsSheet_(SLOT_SETTINGS_MEAL_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0] || [];
  const idx = buildHeaderIndex_(headers);
  const settings = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const start = parseTimeParts_(row[idx['開始時刻']]);
    const end = parseTimeParts_(row[idx['結束時刻']]);
    const minGapMinutes = parseInt(row[idx['最短空檔(分鐘)']], 10);
    const days = parseWeekdaySet_(row[idx['適用星期']]);
    if (!start || !end || !minGapMinutes || !days.size) continue;

    days.forEach(day => {
      const key = String(day);
      if (!settings[key]) settings[key] = [];
      settings[key].push({
        startH: start.hour,
        startM: start.minute,
        endH: end.hour,
        endM: end.minute,
        minGapMinutes: minGapMinutes
      });
    });
  }

  return settings;
}

function readSpecialRules_() {
  const sheet = getRequiredSlotSettingsSheet_(SLOT_SETTINGS_SPECIAL_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0] || [];
  const idx = buildHeaderIndex_(headers);
  const settings = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const type = normalizeSpecialRuleType_(row[idx['類型']]);
    const days = parseWeekdaySet_(row[idx['適用星期']]);
    const durationMinutes = parseInt(row[idx['課長(分鐘)']], 10);
    const openSlotParts = parseTimeParts_(row[idx['開放時段']]);
    if (!type || !days.size || !durationMinutes || !openSlotParts) continue;

    days.forEach(day => {
      const key = String(day);
      if (!settings[key]) settings[key] = [];
      settings[key].push({
        type: type,
        durationMinutes: durationMinutes,
        triggerCondition: row[idx['觸發條件']] || '',
        openSlot: formatTime_(openSlotParts.hour, openSlotParts.minute)
      });
    });
  }

  return settings;
}

function getSlotSettingsSpreadsheet_() {
  if (!SHEET_ID) throw new Error('SHEET_ID script property is not set');
  return SpreadsheetApp.openById(SHEET_ID);
}

function getRequiredSlotSettingsSheet_(sheetName) {
  const sheet = getSlotSettingsSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`找不到工作表：${sheetName}`);
  return sheet;
}

function ensureSlotSettingSheet_(spreadsheet, sheetName, headers, rows) {
  if (spreadsheet.getSheetByName(sheetName)) {
    Logger.log(`${sheetName} 已存在，略過建立`);
    return;
  }

  const sheet = spreadsheet.insertSheet(sheetName);
  sheet.getRange(1, 1, rows.length + 1, headers.length).setValues([headers].concat(rows));
  Logger.log(`${sheetName} 已建立並填入預設資料`);
}

function buildHeaderIndex_(headers) {
  return headers.reduce((idx, header, columnIndex) => {
    idx[String(header).trim()] = columnIndex;
    return idx;
  }, {});
}

function parseTimeParts_(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return { hour: value.getHours(), minute: value.getMinutes() };
  }

  if (typeof value === 'number') {
    const totalMinutes = value < 1 ? Math.round(value * 24 * 60) : Math.round(value * 60);
    return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
  }

  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return null;
  return {
    hour: parseInt(match[1], 10),
    minute: match[2] ? parseInt(match[2], 10) : 0
  };
}

function parseWeekdaySet_(value) {
  const days = new Set();
  if (value === null || typeof value === 'undefined') return days;

  String(value).split(/[,\uFF0C、\s]+/).forEach(part => {
    const token = part.replace(/^週|^星期/g, '').trim();
    if (!token) return;

    const day = {
      '日': 0,
      '天': 0,
      '七': 0,
      '一': 1,
      '二': 2,
      '三': 3,
      '四': 4,
      '五': 5,
      '六': 6,
      '0': 0,
      '7': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6
    }[token];

    if (typeof day !== 'undefined') days.add(day);
  });

  return days;
}

function parseOpenValue_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return !['否', '不開放', '關閉', 'false', '0', 'no', 'n'].includes(normalized);
}

function normalizeSpecialRuleType_(value) {
  const text = String(value || '').trim();
  if (text === '早鳥' || text === 'EARLY_BIRD') return 'EARLY_BIRD';
  if (text === '夜場' || text === '夜間加班' || text === 'NIGHT_EXTEND') return 'NIGHT_EXTEND';
  return '';
}

function formatTime_(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getFallbackBusinessHours_(dayOfWeek) {
  if (dayOfWeek === 1) return { startH: 10, endH: 17, isOpen: true };
  if (dayOfWeek === 0) return { startH: 12, endH: 17, isOpen: true };
  return { startH: 14, endH: 22, isOpen: true };
}

function getFallbackBusinessSettings_() {
  const settings = {};
  for (let day = 0; day <= 6; day++) {
    settings[String(day)] = getFallbackBusinessHours_(day);
  }
  return settings;
}

function getFallbackMealSettings_() {
  const settings = {};
  for (let day = 0; day <= 6; day++) {
    if (day === 1) {
      settings[String(day)] = [{
        startH: 11,
        startM: 0,
        endH: 13,
        endM: 0,
        minGapMinutes: 60
      }];
    } else if (day >= 2 && day <= 6) {
      settings[String(day)] = [{
        startH: 16,
        startM: 30,
        endH: 18,
        endM: 30,
        minGapMinutes: 60
      }];
    } else {
      settings[String(day)] = [];
    }
  }
  return settings;
}

function getFallbackSpecialRules_() {
  const settings = {};
  for (let day = 0; day <= 6; day++) {
    settings[String(day)] = [{
      type: 'NIGHT_EXTEND',
      durationMinutes: 80,
      triggerCondition: '無',
      openSlot: '21:00'
    }];
  }

  for (let day = 2; day <= 6; day++) {
    settings[String(day)].push({
      type: 'EARLY_BIRD',
      durationMinutes: 80,
      triggerCondition: '當日15:00已被預約',
      openSlot: '13:30'
    });
  }

  return settings;
}
