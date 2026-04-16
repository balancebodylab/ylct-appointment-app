// ================= 日曆快取模組 (CalendarCache v7.9.5) =================

const CACHE_KEY_CALENDAR = 'CALENDAR_EVENTS_30DAYS';
const CACHE_DURATION = 21600; // 快取存活時間 (秒)，設長一點沒關係，因為我們會主動更新

/**
 * [背景定時任務] 全量同步日曆至快取
 * 建議觸發器：每 15 分鐘執行一次
 */
/**
 * [背景定時任務] 全量同步日曆至共享快取
 */
function refreshCalendarCache() {
  console.log("🔄 開始同步大一統日曆快取...");
  if (!CALENDAR_ID) {
    console.warn("⚠️ 缺少 CALENDAR_ID，無法同步日曆快取");
    return;
  }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    console.warn("⚠️ 找不到 CALENDAR_ID 對應的日曆，無法同步日曆快取");
    return;
  }

  const now = new Date();
  const future = new Date();
  future.setDate(now.getDate() + 45); 

  const events = calendar.getEvents(now, future);
  
  // ⚡️ 統一資料格式：s(開始), e(結束), t(標題), i(ID), d(描述/電話)
  const simpleEvents = events.map(e => ({
    i: e.getId(),               
    s: e.getStartTime().getTime(), 
    e: e.getEndTime().getTime(),   
    t: e.getTitle(),
    d: e.getDescription() || "" // 💡 保留描述，供查詢紀錄篩選電話用
  }));

  const cache = CacheService.getScriptCache();
  try {
    // 統一使用 CACHE_KEY_CALENDAR ('CALENDAR_EVENTS_30DAYS')
    cache.put(CACHE_KEY_CALENDAR, JSON.stringify(simpleEvents), 21600);
    console.log(`✅ 快取同步完成 (共 ${simpleEvents.length} 筆)`);
  } catch (e) {
    console.error("❌ 快取失敗：資料量可能超過 100KB，請考慮只儲存描述中的電話部分。");
  }
}


/**
 * [樂觀更新] 從快取中立即剔除預約 (對照表 + 雙重過濾版)
 */
function removeEventFromCache(eventId, dateTimeStr, phone) {
  const cache = CacheService.getScriptCache();
  let targetId = eventId;
  
  // 1. 💡 查閱對照表：如果傳進來的是 temp_，換成真實 ID
  if (eventId.toString().startsWith('temp_')) {
    const mappedRealId = cache.get('MAP_' + eventId);
    if (mappedRealId) {
      targetId = mappedRealId; // 成功找到真實身份！
      console.log(`🔗 [對照表命中] ${eventId} 轉換為真實 ID: ${targetId}`);
    }
  }

  const cachedJson = cache.get(CACHE_KEY_CALENDAR);
  if (!cachedJson) return false;

  let allEvents = JSON.parse(cachedJson);
  const initialLength = allEvents.length;
  
  // 處理時間格式 (相容 iOS Safari 的安全解析法)
  let targetTs = null;
  if (dateTimeStr) {
    targetTs = new Date(dateTimeStr.replace(/-/g, '/').replace('T', ' ') + ':00').getTime();
  }

  // 2. ⚡️ 雙重過濾
  allEvents = allEvents.filter(e => {
    if (e.i === targetId) return false; // 條件 1：查表後的 ID 吻合 -> 剔除
    // 條件 2：時間誤差 1 分鐘內，且描述含該電話 -> 剔除 (終極防脫鉤)
    if (targetTs && Math.abs(e.s - targetTs) < 60000 && (e.d || '').includes(phone)) return false; 
    return true; 
  });

  if (allEvents.length < initialLength) {
    cache.put(CACHE_KEY_CALENDAR, JSON.stringify(allEvents), CACHE_DURATION);
    console.log(`⚡️ [樂觀取消] 成功從快取移除預約 (釋放時段)`);
    return true;
  }

  console.warn(`⚠️ [樂觀取消] 快取中找不到要移除的預約，準備改走完整刷新`);
  return false;
}

// 預約時呼叫：addEventToCache(start, end, title, description)
function addEventToCache(startTime, endTime, title, description, tempId) {
  const cache = CacheService.getScriptCache();
  const cachedJson = cache.get(CACHE_KEY_CALENDAR);
  
  if (!cachedJson) { refreshCalendarCache(); return; }

  let allEvents = JSON.parse(cachedJson);
  allEvents.push({
    i: tempId, // 💡 使用 createBooking 傳來的固定 Temp ID
    s: startTime.getTime(),
    e: endTime.getTime(),
    t: title,
    d: description
  });

  cache.put(CACHE_KEY_CALENDAR, JSON.stringify(allEvents), CACHE_DURATION);
  console.log(`⚡️ [智慧預約] 已寫入共享快取 (ID: ${tempId})`);
}
// 取消時呼叫：removeEventFromCache(eventId)

/**
 * [讀取] 取得行程 (優先讀快取，沒有則讀 Live API)
 */
function getEventsWithCache(start, end) {
  const cache = CacheService.getScriptCache();
  const cachedJson = cache.get(CACHE_KEY_CALENDAR);

  if (cachedJson) {
    // A. 命中快取 (極速)
    // console.log("✨ 使用日曆快取"); 
    const allEvents = JSON.parse(cachedJson);
    const startMs = start.getTime();
    const endMs = end.getTime();

    // 過濾出符合當天範圍的行程
    return allEvents.filter(e => e.e > startMs && e.s < endMs).map(e => ({
      getStartTime: () => new Date(e.s),
      getEndTime: () => new Date(e.e),
      getTitle: () => e.t
    }));
  } else {
    // B. 快取失效，走 Live API (較慢，但保證有資料)
    console.log("⚠️ 快取未命中，呼叫 Google Calendar API");
    // 順便觸發一次更新，造福下一個人
    //refreshCalendarCache(); 
    return CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
  }
}

/**
 * [清除] 當有新預約或取消時呼叫
 */
function invalidateCalendarCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_CALENDAR);
  console.log("🧹 日曆快取已清除 (標記為髒資料)");
  
  // 選擇性：也可以這裡直接呼叫 refreshCalendarCache() 立即重建
  // 但為了回應速度，建議單純清除即可，下次讀取時會自動重建
}

function refreshCalendarCacheAfterCancellation() {
  invalidateCalendarCache();
  Utilities.sleep(300);
  refreshCalendarCache();
}

/**
 * [Calendar 觸發器] 當日曆被手動改期/新增/刪除時，刷新前端查詢用快取
 */
function onAppointmentCalendarEventUpdated(e) {
  invalidateCalendarCache();
  refreshCalendarCache();
}
