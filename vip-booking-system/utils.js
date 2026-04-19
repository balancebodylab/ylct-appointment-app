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
function pickHeaderValue_(rawUser, candidates) {
  const normalizedMap = {};

  Object.keys(rawUser).forEach(function(key) {
    normalizedMap[String(key).trim().toLowerCase()] = rawUser[key];
  });

  for (let i = 0; i < candidates.length; i++) {
    const normalizedKey = String(candidates[i]).trim().toLowerCase();
    const value = normalizedMap[normalizedKey];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

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
    name: pickHeaderValue_(rawUser, ['客戶姓名', '姓名']) || '',
    
    // 把電話前面的單引號 (') 濾掉，確保前端拿到乾淨的數字
    phone: String(pickHeaderValue_(rawUser, ['電話']) || '').replace(/'/g, ''), 
    
    lineUserId: pickHeaderValue_(rawUser, ['Line ID', 'LineID', 'LINE ID', 'line id']) || '',
    
    // 以下這些是前端畫面顯示需要的，如果您的表裡面沒有這些標題，就會帶入預設值 (0 或 '無方案')
    planName: pickHeaderValue_(rawUser, ['方案內容', '課程名稱']) || '新客體驗',
    courseBalance: parseInt(pickHeaderValue_(rawUser, ['總剩餘堂數', '剩餘堂數']) || 0) || 0,
    ticketBalance: parseInt(pickHeaderValue_(rawUser, ['剩餘加時券數量', '加時券剩餘']) || 0) || 0
  };
}

function testRowToUserObjLineId() {
  const headersWithSpace = ['客戶編號', '客戶姓名', '電話', 'Line ID', '方案內容', '總剩餘堂數', '剩餘加時券數量'];
  const row = [1, '小明', '0912345678', 'U123abc', '課程A', 5, 2];
  const userWithSpace = rowToUserObj(row, headersWithSpace);
  if (userWithSpace.lineUserId !== 'U123abc') {
    throw new Error("Expected Line ID header to map lineUserId to U123abc");
  }

  const headersNoSpace = ['客戶編號', '客戶姓名', '電話', 'LineID', '方案內容', '總剩餘堂數', '剩餘加時券數量'];
  const userNoSpace = rowToUserObj(row, headersNoSpace);
  if (userNoSpace.lineUserId !== 'U123abc') {
    throw new Error("Expected LineID header to map lineUserId to U123abc");
  }

  const headersWithoutLineId = ['客戶編號', '客戶姓名', '電話', '方案內容', '總剩餘堂數', '剩餘加時券數量'];
  const rowWithoutLineId = [1, '小明', '0912345678', '課程A', 5, 2];
  const userWithoutLineId = rowToUserObj(rowWithoutLineId, headersWithoutLineId);
  if (userWithoutLineId.lineUserId !== '') {
    throw new Error("Expected missing Line ID header to map lineUserId to empty string");
  }

  console.log('testRowToUserObjLineId: PASS');
  console.log('Line ID header:', userWithSpace.lineUserId);
  console.log('LineID header:', userNoSpace.lineUserId);
  console.log('Missing Line ID header:', userWithoutLineId.lineUserId);
}

function clearBadCache() {
  CacheService.getScriptCache().remove('CALENDAR_EVENTS_30DAYS');
  console.log("✅ 壞掉的快取已清除！");
}
