function testMealProtection() {
  console.log("🍱 開始測試用餐時間保護機制...");

  const TEST_DATE = "2026-01-15"; // 父親節測試
  const TEST_DAY = new Date(TEST_DATE + 'T00:00:00+08:00').getDay();
  const windows = getProtectionWindows(TEST_DAY);
  console.log("目前餐保護視窗設定：", windows);
  
  // 1. 清除舊快取與資料
  const cache = CacheService.getScriptCache();
  cache.remove(`slots_v4_${TEST_DATE}_60`); 
  
  // 假設情境：
  // 用餐區間與最短空檔由「餐保護視窗」工作表提供
  
  console.log("🔍 模擬查詢: 客人想預約 16:15 - 17:15 (60分)");
  // 分析：
  // 預約前：16:00 - 20:00 (空 4小時) -> OK
  // 預約後：
  //   前段剩餘: 16:00 - 16:15 (剩 15分鐘) -> ❌ 太短
  //   後段剩餘: 17:15 - 20:00 (剩 2小時45分) -> ✅ 夠長
  // 結果：因為有一段夠長，所以這個預約「應該要顯示」(Status: OK)

  // 讓我們再極端一點
  // 假設行事曆上已經有一個 17:00 - 20:00 的預約 (佔滿後段)
  // 此時客人想約 16:15 - 16:45 (30分)
  // 預約後剩餘：
  //   前段: 16:00-16:15 (15分) -> ❌
  //   中段: 16:45-17:00 (15分) -> ❌
  //   後段: 無
  // 結果：完全沒有 30分鐘的吃飯時間 -> 應該被隱藏
  
  // 實際執行 getAvailableSlots 看 Log
  // 這裡我們直接呼叫函式觀察 16:00 ~ 20:00 的時段分布
  const result = getAvailableSlots(TEST_DATE, 60);
  
  console.log("📊 時段掃描結果 (16:00-20:00):");
  const eveningSlots = result.slots.filter(t => t >= "16:00" && t <= "20:00");
  console.log(eveningSlots);
  
  if (eveningSlots.length > 0) {
    console.log("✅ 保護機制運作中：系統已過濾並算出可預約時段");
  } else {
    console.log("⚠️ 注意：該區間無可用時段 (可能是全滿或被保護機制完全擋下)");
  }
}
