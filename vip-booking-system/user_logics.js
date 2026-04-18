/// ================= 使用者邏輯 (UserLogic v7.9.7 Memory Structure) =================

/**
 * 讀取使用者資料 (極速版：快取 + 記憶體陣列搜尋)
 */
function loginUser(phone) {
  // 1. 【第一層加速】優先檢查快取 (Cache Service)
  // 如果 20 分鐘內登入過，直接回傳，連試算表都不用開
  const cache = CacheService.getScriptCache();
  const cleanInputPhone = phone.toString().replace(/\D/g, ''); // 只留數字
  const cacheKey = 'user_login_' + cleanInputPhone;
  
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log("⚡️ [快取命中] 使用者資料來自記憶體");
    return JSON.parse(cachedData);
  }

  // 2. 【第二層加速】一次讀取整張表到 Data Structure (2D Array)
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('客戶資料總覽');
  if (!sheet) return { success: false, message: 'Users sheet not found' };

  // 只呼叫一次 API，把整張表讀進記憶體 (這是最耗時的一步，約 0.5s~1s)
  // data 是一個二維陣列 [ [id, name, phone...], [id, name, phone...] ]
  const data = sheet.getDataRange().getValues();

  // 3. 在記憶體中快速查找 (JavaScript 運算極快)
  // 我們假設電話在第 3 欄 (Index 2)，且資料從第 2 列開始 (Index 1)
  // 使用 Array.find 進行掃描
  const foundRow = data.find((row, index) => {
    if (index === 0) return false; // 跳過標題列
    if (!row[2]) return false;     // 跳過空電話
    
    // 比對時一律把符號拿掉，確保格式相容 (例如 0912-345-678 vs 0912345678)
    const rowPhone = row[2].toString().replace(/\D/g, '');
    return rowPhone === cleanInputPhone;
  });

  if (foundRow) {
    // 找到資料，建立物件
    // 欄位對應：[0]ID, [1]姓名, [2]電話, [3]金額, [4]堂數, [5]加時, [6]200券, [7]300券, [8]方案
    
    // 解析課程名稱分鐘數
    const rawCourseName = foundRow[8] ? foundRow[8].toString() : ''; 
    let extractedDuration = 0; 
    const match = rawCourseName.match(/(\d+)\s*(分鐘|分|min)/i);
    if (match) extractedDuration = parseInt(match[1], 10); 

    const result = { 
      success: true, 
      user: {
        id: foundRow[0],
        name: foundRow[1],
        phone: foundRow[2].toString().replace(/'/g, "").trim(),
        totalSpent: foundRow[3],
        courses: parseInt(foundRow[4] || 0),
        tickets: parseInt(foundRow[5] || 0),
        voucher200: parseInt(foundRow[6] || 0),
        voucher300: parseInt(foundRow[7] || 0),
        planName: rawCourseName,       
        defaultDuration: extractedDuration 
    }};

    // 4. 寫入快取 (下次連表都不用讀)
    cache.put(cacheKey, JSON.stringify(result), 1200); // 存 20 分鐘

    return result;
  }
  
  // 查無此人
  return { 
    success: false, 
    user: { 
      name: '新朋友', 
      phone: phone, 
      courses: 0, 
      tickets: 0, 
      planName: '', 
      defaultDuration: 0 
    }
  };
}

// ==========================================
// ==========================================
// 1. 新增：透過 Line ID 登入 (極速快取版：同時查「總覽」與「名單」)
// ==========================================
function loginByLine(lineUserId) {
  if (!lineUserId) return { success: false, message: "無效的 Line ID" };

  // 🚀 【第一層：快取檢查】
  const cache = CacheService.getScriptCache();
  const cacheKey = 'line_login_' + lineUserId;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("⚡️ [快取命中] Line 登入資料來自記憶體");
    return JSON.parse(cached);
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  let result = { success: false, message: "找不到會員資料" };
  
  // ⏱️ 【第二層：總覽表搜尋】 (具有餘額資訊)
  const overviewSheet = ss.getSheetByName("客戶資料總覽");
  if (overviewSheet) {
    const data = overviewSheet.getDataRange().getValues();
    const headers = data[2]; // 標題列在 Index 2 (第 3 列)
    let lineColIdx = headers.indexOf("Line ID");
    if (lineColIdx === -1) lineColIdx = headers.indexOf("LineID"); 

    if (lineColIdx !== -1) {
      for (let i = 3; i < data.length; i++) { // 資料從 Index 3 開始
        if (String(data[i][lineColIdx]) === String(lineUserId)) {
          console.log("✅ [loginByLine] 於「客戶資料總覽」找到會員");
          result = { success: true, user: rowToUserObj(data[i], headers) };
          break;
        }
      }
    }
  }

  // ⏱️ 【第三層：名單表搜尋】 (如果總覽沒找到)
  if (!result.success) {
    const listSheet = ss.getSheetByName("客戶名單");
    if (listSheet) {
      const listData = listSheet.getDataRange().getValues();
      // 客戶名單 [ID, 姓名, 電話, Line ID, ...] -> Line ID 在 Index 3
      for (let j = 1; j < listData.length; j++) {
        if (String(listData[j][3]) === String(lineUserId)) {
          console.log("✅ [loginByLine] 於「客戶名單」找到會員");
          const phone = String(listData[j][2] || '').replace(/'/g, '');
          
          // 嘗試用電話回頭查總覽 (確保餘額同步)
          if (phone) {
            const overviewResult = loginUser(phone);
            if (overviewResult.success) {
              result = { success: true, user: { ...overviewResult.user, lineUserId: lineUserId } };
            } else {
              result = {
                success: true,
                user: { name: listData[j][1], phone: phone, lineUserId: lineUserId, planName: "新客體驗", courseBalance: 0, ticketBalance: 0 }
              };
            }
          }
          break;
        }
      }
    }
  }

  // 💾 【寫入快取】 存 20 分鐘
  if (result.success) {
    cache.put(cacheKey, JSON.stringify(result), 1200);
  }

  return result;
}
/*
function loginByLine(data) {
  const uid = data.lineUserId;
  const displayName = data.lineDisplayName; // 👈 接收前端傳來的朋友姓名
  
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("客戶資料總覽");
  const rows = sheet.getDataRange().getValues();
  const headers = rows[2]; // 標題列在第 3 行

  const col = {
    name: headers.indexOf("姓名"),
    phone: headers.indexOf("電話"),
    lineId: headers.indexOf("Line ID")
  };

  let potentialMatch = null;

  // 遍歷所有客戶資料
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    
    // 🔍 1. 優先比對 Line ID (最精準)
    if (String(row[col.lineId]) === String(uid)) {
      return { success: true, status: "LOGGED_IN", user: rowToUserObj(row, headers) };
    }

    // 🔍 2. 備案：比對姓名 (且該列尚未綁定 Line ID)
    if (!row[col.lineId] && String(row[col.name]) === String(displayName)) {
      potentialMatch = {
        rowIndex: i + 1,
        name: row[col.name],
        phone: row[col.phone]
      };
    }
  }

  // ⚡️ 發現匹配的老客戶名單
  if (potentialMatch) {
    // 如果連電話都有了，直接自動綁定
    if (potentialMatch.phone) {
      sheet.getRange(potentialMatch.rowIndex, col.lineId + 1).setValue(uid);
      const updatedRow = sheet.getRange(potentialMatch.rowIndex, 1, 1, headers.length).getValues()[0];
      return { success: true, status: "AUTO_BOUND", user: rowToUserObj(updatedRow, headers) };
    } 
    // 有名字但沒電話，回傳狀態讓前端跳出輸入框
    return { success: true, status: "NEED_PHONE_VERIFY", tempMatch: potentialMatch };
  }

  return { success: false, message: "查無此人" };
}
*/
// ==========================================
// 補全老客戶資料並綁定 Line ID
// ==========================================
function completeBinding(lineUserId, phone, rowIndex) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("客戶資料總覽");
    const headers = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const colIdx = {
      phone: headers.indexOf("電話") + 1,
      lineId: headers.indexOf("Line ID") + 1
    };

    // 寫入電話與 Line ID
    sheet.getRange(rowIndex, colIdx.phone).setNumberFormat("@").setValue(String(phone || '').replace(/^'/, ''));
    sheet.getRange(rowIndex, colIdx.lineId).setValue(lineUserId);

    // 重新撈取該行完整資料回傳前端
    const updatedRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    return { success: true, user: rowToUserObj(updatedRow, headers) };
    
  } catch (e) {
    console.error("綁定失敗: " + e.toString());
    return { success: false, error: e.toString() };
  }
}
// ==========================================
// 2. 新增：註冊新會員
// ==========================================
function registerNewUser(d) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("客戶名單");
  sheet.getRange("C:C").setNumberFormat("@");
  
  // 準備要寫入的資料
  // 欄位對應：[ID, 姓名, 電話, Line ID, 生日, 註冊時間]
  const newRow = [
    "",
    d.name,           // 姓名
    "'" + d.phone,    // 電話 (加 ' 避免變數字)
    d.lineUserId,     // Line User ID
    d.birthday || "", // 生日 (新加入)
    new Date()        // 註冊時間
  ];

  sheet.appendRow(newRow);
  sheet.getRange(sheet.getLastRow(), 3).setNumberFormat("@");

  // 註冊完直接回傳會員物件，讓前端不用再登入一次
  return { 
    success: true, 
    user: {
      name: d.name,
      phone: d.phone,
      lineUserId: d.lineUserId,
      planName: "新客體驗",
      courseBalance: 0,
      ticketBalance: 0
    }
  };
}
