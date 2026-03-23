// ================= 工具函式 (Utils) =================

/**
 * 輔助函式：取得中文星期幾
 * @param {string} dateStr - 格式 yyyy-MM-dd
 */
function getDayOfWeekCN(dateStr) {
  const days = ['(日)', '(一)', '(二)', '(三)', '(四)', '(五)', '(六)'];
  // 將 - 換成 / 以確保 Safari/GAS 相容性
  const d = new Date(dateStr.replace(/-/g, '/')); 
  return days[d.getDay()];
}

// ==========================================
// 輔助函式：將試算表的一列資料轉為 User 物件
// ==========================================
function rowToUserObj(row, headers) {
  let rawUser = {};
  
  // 1. 先把每一欄的資料，對應到標題列的名稱上
  for (let i = 0; i < headers.length; i++) {
    let key = String(headers[i]).trim();
    rawUser[key] = row[i];
  }

  // 2. 轉換成前端需要的標準格式
  // 注意：這裡的 rawUser['中文'] 必須跟您試算表第一列的標題一模一樣！
  return {
    name: rawUser['客戶姓名'] || '',
    
    // 把電話前面的單引號 (') 濾掉，確保前端拿到乾淨的數字
    phone: String(rawUser['電話'] || '').replace(/'/g, ''), 
    
    lineUserId: rawUser['LineID'] || '',
    
    // 以下這些是前端畫面顯示需要的，如果您的表裡面沒有這些標題，就會帶入預設值 (0 或 '無方案')
    planName: rawUser['方案內容'] || rawUser['課程名稱'] || '新客體驗',
    courseBalance: parseInt(rawUser['總剩餘堂數']  || 0) || 0,
    ticketBalance: parseInt(rawUser['剩餘加時券數量'] || 0) || 0
  };
}

function clearBadCache() {
  CacheService.getScriptCache().remove('CALENDAR_EVENTS_30DAYS');
  console.log("✅ 壞掉的快取已清除！");
}