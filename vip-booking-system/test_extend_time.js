/**
 * v7.5.3 邏輯驗證測試
 * 目標日期：2026-01-15 (週四)
 * 測試項目：早鳥連動 (13:30)、夜間特例 (21:00)
 */
function test_v753_scenarios() {
  const TEST_DATE = '2026-01-22'; // 週四
  const CAL_ID = 'primary'; // 確保與主程式一致
  const calendar = CalendarApp.getCalendarById(CAL_ID);
  
  console.log(`🚀 開始測試 v7.5.3 | 日期: ${TEST_DATE}`);
  console.log('------------------------------------------------');

  // ==========================================
  // 準備工作：清理測試當天 15:00 - 16:00 的干擾行程
  // ==========================================
  const startClean = new Date(TEST_DATE + 'T15:00:00+08:00');
  const endClean = new Date(TEST_DATE + 'T16:00:00+08:00');
  const existingEvents = calendar.getEvents(startClean, endClean);
  if (existingEvents.length > 0) {
    console.log(`🧹 清理環境：刪除 ${existingEvents.length} 個現有行程以確保測試準確...`);
    existingEvents.forEach(e => e.deleteEvent());
  }

  // ==========================================
  // 情境二：15:00 無預約 -> 13:30 不應出現
  // ==========================================
  console.log('\n🧪 [測試情境二]：15:00 空檔，查 80 分鐘');
  
  // 呼叫 API (無快取)
  let result2 = getAvailableSlots(TEST_DATE, '80'); 
  let has1330_case2 = result2.slots.includes('13:30');
  
  if (has1330_case2 === false) {
    console.log('✅ 通過：15:00 無人，13:30 未顯示。');
  } else {
    console.error('❌ 失敗：15:00 無人，但 13:30 卻出現了！');
  }

  // ==========================================
  // 情境一：15:00 有預約 -> 13:30 應出現
  // ==========================================
  console.log('\n🧪 [測試情境一]：15:00 建立預約，查 80 分鐘');
  
  // 建立一個測試用預約 (15:00 - 16:00)
  let testEvent = calendar.createEvent('[測試用] 佔位', startClean, endClean);
  Utilities.sleep(1000); // 等待寫入生效
  
  // 再次呼叫 API
  let result1 = getAvailableSlots(TEST_DATE, '80');
  let has1330_case1 = result1.slots.includes('13:30');
  
  if (has1330_case1 === true) {
    console.log('✅ 通過：15:00 有人，系統正確開放 13:30 (早鳥連動)。');
  } else {
    console.error('❌ 失敗：15:00 有人，但 13:30 沒有顯示。');
    console.log('   當前 Slots:', result1.slots);
  }

  // ==========================================
  // 情境三：查 21:00 (80分鐘) -> 應顯示
  // ==========================================
  console.log('\n🧪 [測試情境三]：夜間特例，查 21:00 (80分鐘)');
  
  let has2100 = result1.slots.includes('21:00'); // 使用剛剛的查詢結果即可
  
  if (has2100 === true) {
    console.log('✅ 通過：21:00 選項有顯示 (無視 22:00 關門限制)。');
  } else {
    console.error('❌ 失敗：21:00 選項被擋住了。');
  }

  // ==========================================
  // 情境四：查 21:30 (80分鐘) -> 不應顯示
  // ==========================================
  console.log('\n🧪 [測試情境四]：非特例時間，查 21:30 (80分鐘)');
  
  let has2130 = result1.slots.includes('21:30');
  
  if (has2130 === false) {
    console.log('✅ 通過：21:30 選項未顯示 (正確被擋下)。');
  } else {
    console.error('❌ 失敗：21:30 選項竟然顯示了！');
  }

  // ==========================================
  // 收尾：刪除測試產生的預約
  // ==========================================
  console.log('\n🧹 測試結束，正在刪除測試建立的預約...');
  testEvent.deleteEvent();
  console.log('🏁 測試完成。');
}
