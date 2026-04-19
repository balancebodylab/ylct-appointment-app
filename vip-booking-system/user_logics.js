/// ================= 使用者邏輯 (UserLogic v7.9.7 Memory Structure) =================

/**
 * 在前 N 列中搜尋真正 header 列。
 * 判斷條件：該列必須同時包含 KEY_HEADERS 全部關鍵欄位（避免被統計數字小標列騙到）。
 * 回傳 { headerRowIndex, headers, dataStartIndex }；找不到時回傳 null。
 */
function locateOverviewHeaderRow_(data, searchRows) {
  const KEY_HEADERS = ['客戶姓名', '電話'];
  const limit = Math.min(searchRows || 5, data.length);
  for (let i = 0; i < limit; i++) {
    const row = data[i] || [];
    const normalized = row.map(function(v) { return String(v == null ? '' : v).trim(); });
    const allFound = KEY_HEADERS.every(function(k) { return normalized.indexOf(k) !== -1; });
    if (allFound) {
      return { headerRowIndex: i, headers: row, dataStartIndex: i + 1 };
    }
  }
  return null;
}

/**
 * 在 header row 中找指定欄位 index，支援多個別名 + 大小寫/空白容錯。
 */
function findHeaderColumn_(headers, aliases) {
  for (let a = 0; a < aliases.length; a++) {
    const idx = headers.indexOf(aliases[a]);
    if (idx !== -1) return idx;
  }
  const normalized = headers.map(function(h) {
    return String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, '');
  });
  for (let a = 0; a < aliases.length; a++) {
    const target = String(aliases[a]).trim().toLowerCase().replace(/\s+/g, '');
    const idx = normalized.indexOf(target);
    if (idx !== -1) return idx;
  }
  return -1;
}

function findInCustomerList_(phone) {
  const normalizedInput = normalizeCustomerPhoneForList_(phone);
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("客戶名單");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const col = getCustomerListColumnMap_(headers);

  for (let i = 1; i < data.length; i++) {
    const row = data[i] || [];
    if (normalizeCustomerPhoneForList_(row[col.phone]) === normalizedInput) {
      return {
        success: true,
        user: {
          id: row[col.id],
          name: row[col.name],
          phone: normalizedInput,
          lineUserId: String(row[col.lineId] || ''),
          planName: '新客體驗',
          courseBalance: 0,
          ticketBalance: 0,
          courses: 0,
          tickets: 0,
          defaultDuration: 0
        }
      };
    }
  }

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

  const cacheAndReturn = function(result) {
    cache.put(cacheKey, JSON.stringify(result), 1200);
    return result;
  };
  const fallbackAndCache = function() {
    const result = findInCustomerList_(phone) || {
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
    return cacheAndReturn(result);
  };

  // 2. 【第二層加速】一次讀取整張表到 Data Structure (2D Array)
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('客戶資料總覽');
  if (!sheet) return fallbackAndCache();

  // 只呼叫一次 API，把整張表讀進記憶體 (這是最耗時的一步，約 0.5s~1s)
  // data 是一個二維陣列 [ [id, name, phone...], [id, name, phone...] ]
  const data = sheet.getDataRange().getValues();
  const located = locateOverviewHeaderRow_(data, 5);
  if (!located) return fallbackAndCache();

  // 3. 在記憶體中快速查找 (JavaScript 運算極快)
  const phoneCol = findHeaderColumn_(located.headers, ['電話']);
  if (phoneCol === -1) return fallbackAndCache();

  for (let i = located.dataStartIndex; i < data.length; i++) {
    const row = data[i] || [];
    if (!row[phoneCol]) continue;

    // 比對時一律把符號拿掉，確保格式相容 (例如 0912-345-678 vs 0912345678)
    const rowPhone = row[phoneCol].toString().replace(/\D/g, '');
    if (rowPhone !== cleanInputPhone) continue;

    const user = rowToUserObj(row, located.headers);

    // 解析課程名稱分鐘數
    const rawCourseName = user.planName ? user.planName.toString() : '';
    let extractedDuration = 0;
    const match = rawCourseName.match(/(\d+)\s*(分鐘|分|min)/i);
    if (match) extractedDuration = parseInt(match[1], 10);

    const idCol = findHeaderColumn_(located.headers, ['客戶編號']);
    user.id = idCol === -1 ? '' : row[idCol];
    user.defaultDuration = extractedDuration;

    const result = { success: true, user: user };

    // 4. 寫入快取 (下次連表都不用讀)
    return cacheAndReturn(result);
  }
  
  // 查無此人
  return fallbackAndCache();
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
    const located = locateOverviewHeaderRow_(data, 5);
    if (located) {
      const headers = located.headers;
      const lineColIdx = findHeaderColumn_(headers, ['Line ID', 'LineID', 'LINE ID', 'line id', 'Line Id']);

      if (lineColIdx !== -1) {
        for (let i = located.dataStartIndex; i < data.length; i++) {
          if (String(data[i][lineColIdx]) === String(lineUserId)) {
            console.log("✅ [loginByLine] 於「客戶資料總覽」找到會員");
            result = { success: true, user: rowToUserObj(data[i], headers) };
            break;
          }
        }
      }
    }
  }

  // ⏱️ 【第三層：名單表搜尋】 (如果總覽沒找到)
  if (!result.success) {
    const listSheet = ss.getSheetByName("客戶名單");
    if (listSheet) {
      const listData = listSheet.getDataRange().getValues();
      const listHeaders = listData[0] || [];
      const listCols = getCustomerListColumnMap_(listHeaders);
      for (let j = 1; j < listData.length; j++) {
        if (String(listData[j][listCols.lineId]) === String(lineUserId)) {
          console.log("✅ [loginByLine] 於「客戶名單」找到會員");
          const phone = String(listData[j][listCols.phone] || '').replace(/'/g, '');
          
          // 嘗試用電話回頭查總覽 (確保餘額同步)
          if (phone) {
            const overviewResult = loginUser(phone);
            if (overviewResult.success) {
              result = { success: true, user: { ...overviewResult.user, lineUserId: lineUserId } };
            } else {
              result = {
                success: true,
                user: { name: listData[j][listCols.name], phone: phone, lineUserId: lineUserId, planName: "新客體驗", courseBalance: 0, ticketBalance: 0 }
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
    const allData = sheet.getDataRange().getValues();
    const located = locateOverviewHeaderRow_(allData, 5);
    if (!located) {
      return { success: false, error: '找不到客戶資料總覽 header 列' };
    }
    const headers = located.headers;
    
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

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = getCustomerListColumnMap_(headers);
  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(lastRow - 1, 0);
  const rows = rowCount > 0 ? sheet.getRange(2, 1, rowCount, headers.length).getValues() : [];
  const cleanPhone = normalizeCustomerPhoneForList_(d.phone);
  const cleanLineId = String(d.lineUserId || '').trim();
  let targetRowNumber = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowPhone = normalizeCustomerPhoneForList_(rows[i][col.phone]);
    const rowLineId = String(rows[i][col.lineId] || '').trim();
    if ((cleanPhone && rowPhone === cleanPhone) || (cleanLineId && rowLineId === cleanLineId)) {
      targetRowNumber = i + 2;
      break;
    }
  }

  if (targetRowNumber) {
    const existing = sheet.getRange(targetRowNumber, 1, 1, headers.length).getValues()[0];
    existing[col.name] = existing[col.name] || d.name;
    existing[col.phone] = "'" + cleanPhone;
    existing[col.lineId] = cleanLineId || existing[col.lineId];
    if (d.birthday) existing[col.birthMonth] = d.birthday + "月";
    existing[col.status] = existing[col.status] || "正常";
    existing[col.source] = existing[col.source] || "LIFF";
    sheet.getRange(targetRowNumber, 1, 1, headers.length).setValues([existing]);
    sheet.getRange(targetRowNumber, col.phone + 1).setNumberFormat("@").setValue(cleanPhone);
  } else {
    const newRow = new Array(headers.length).fill("");
    newRow[col.id] = getNextCustomerIdForList_(rows, col.id);
    newRow[col.name] = d.name;
    newRow[col.phone] = "'" + cleanPhone;
    newRow[col.lineId] = cleanLineId;
    newRow[col.birthMonth] = d.birthday ? d.birthday + "月" : "";
    newRow[col.status] = "正常";
    newRow[col.createdAt] = new Date();
    newRow[col.source] = "LIFF";

    sheet.appendRow(newRow);
    targetRowNumber = sheet.getLastRow();
    sheet.getRange(targetRowNumber, col.phone + 1).setNumberFormat("@").setValue(cleanPhone);
  }

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

function normalizeCustomerPhoneForList_(value) {
  const digits = String(value == null ? '' : value).replace(/^'/, '').replace(/\D/g, '');
  if (digits.length === 9 && digits.charAt(0) === '9') return '0' + digits;
  return digits;
}

function getNextCustomerIdForList_(rows, idIndex) {
  let maxId = 813;
  rows.forEach(row => {
    const id = parseInt(String(row[idIndex] || '').trim(), 10);
    if (!isNaN(id)) maxId = Math.max(maxId, id);
  });
  return maxId + 10;
}

function getCustomerListColumnMap_(headers) {
  const indexOfAny = (names, fallback) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1) return index;
    }
    return fallback;
  };

  return {
    id: indexOfAny(["客戶編號", "ID"], 0),
    name: indexOfAny(["客戶稱呼", "姓名"], 1),
    phone: indexOfAny(["電話"], 2),
    lineId: indexOfAny(["Line ID", "LineID"], 3),
    birthMonth: indexOfAny(["生日月份"], 4),
    status: indexOfAny(["狀態"], 5),
    createdAt: indexOfAny(["建立日期", "註冊時間"], 6),
    source: indexOfAny(["來源"], 7),
    note: indexOfAny(["備註"], 8)
  };
}

function testLocateOverviewHeaderRow() {
  const firstRowHeader = locateOverviewHeaderRow_([
    ['客戶姓名', '電話'],
    ['小明', '0912']
  ], 5);
  if (!firstRowHeader || firstRowHeader.headerRowIndex !== 0 || firstRowHeader.dataStartIndex !== 1) {
    throw new Error('Expected header at index 0 with dataStartIndex 1');
  }

  const realShapeHeader = locateOverviewHeaderRow_([
    ['筋摩 x 獵人客戶資料總覽'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '統計', '206', '83'],
    ['客戶編號', '客戶姓名', 'Line ID', '電話', '總購買金額', '總剩餘堂數', '剩餘加時券數量', '剩餘$200 介紹抵用券', '剩餘$300 評論抵用券', '課程名稱', '對應課程代碼', '消費次數', '最近消費日期', '備註', '206', '83', '0', '0', '235,940'],
    ['C001', '小明', 'U123', '0912345678']
  ], 5);
  if (!realShapeHeader || realShapeHeader.headerRowIndex !== 2 || realShapeHeader.dataStartIndex !== 3) {
    throw new Error('Expected real shape header at index 2 with dataStartIndex 3');
  }

  const missingHeader = locateOverviewHeaderRow_([
    ['筋摩 x 獵人客戶資料總覽'],
    ['客戶姓名'],
    ['電話'],
    ['206', '83'],
    ['備註']
  ], 5);
  if (missingHeader !== null) {
    throw new Error('Expected missing header fixture to return null');
  }

  const statsAfterHeader = locateOverviewHeaderRow_([
    ['客戶姓名', '電話', '餘額', '206', '83'],
    ['小明', '0912', 5]
  ], 5);
  if (!statsAfterHeader || statsAfterHeader.headerRowIndex !== 0 || statsAfterHeader.dataStartIndex !== 1) {
    throw new Error('Expected header with trailing stats numbers to match');
  }

  console.log('testLocateOverviewHeaderRow: PASS');
}

function testFindHeaderColumn() {
  if (findHeaderColumn_(['A', 'Line ID', 'B'], ['Line ID']) !== 1) {
    throw new Error('Expected exact Line ID to resolve index 1');
  }
  if (findHeaderColumn_(['A', 'LineID', 'B'], ['Line ID', 'LineID']) !== 1) {
    throw new Error('Expected LineID alias to resolve index 1');
  }
  if (findHeaderColumn_(['A', 'line id', 'B'], ['Line ID']) !== 1) {
    throw new Error('Expected normalized line id to resolve index 1');
  }
  if (findHeaderColumn_(['A', 'B', 'C'], ['Line ID']) !== -1) {
    throw new Error('Expected missing Line ID to resolve -1');
  }

  console.log('testFindHeaderColumn: PASS');
}

function testLoginUserWithHeader() {
  const fakeData = [
    ['筋摩 x 獵人客戶資料總覽'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '統計', '206', '83'],
    ['客戶姓名', '電話', '客戶編號', '課程名稱', '總剩餘堂數', '剩餘加時券數量'],
    ['小明', '0912-345-678', 'C001', '筋膜放鬆 50 分鐘', 8, 2]
  ];
  const located = locateOverviewHeaderRow_(fakeData, 5);
  if (!located || located.dataStartIndex !== 3) {
    throw new Error('Expected fake login data header to be located');
  }

  const phoneCol = findHeaderColumn_(located.headers, ['電話']);
  if (phoneCol !== 1) {
    throw new Error('Expected phone column to follow reordered header index 1');
  }

  const cleanInputPhone = '0912345678';
  let foundRow = null;
  for (let i = located.dataStartIndex; i < fakeData.length; i++) {
    const rowPhone = String(fakeData[i][phoneCol] || '').replace(/\D/g, '');
    if (rowPhone === cleanInputPhone) {
      foundRow = fakeData[i];
      break;
    }
  }
  if (!foundRow) {
    throw new Error('Expected fake login data to find matching phone row');
  }

  const user = rowToUserObj(foundRow, located.headers);
  const idCol = findHeaderColumn_(located.headers, ['客戶編號']);
  const durationMatch = String(user.planName || '').match(/(\d+)\s*(分鐘|分|min)/i);
  user.id = idCol === -1 ? '' : foundRow[idCol];
  user.defaultDuration = durationMatch ? parseInt(durationMatch[1], 10) : 0;

  if (user.id !== 'C001' || user.name !== '小明' || user.phone !== '0912-345-678') {
    throw new Error('Expected user object to preserve id, name, and phone');
  }
  if (user.courseBalance !== 8 || user.ticketBalance !== 2 || user.defaultDuration !== 50) {
    throw new Error('Expected user object to preserve balances and parse duration');
  }

  console.log('testLoginUserWithHeader: PASS');
}
