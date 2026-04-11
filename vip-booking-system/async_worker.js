// ================= 背景工作處理 (AsyncWorker v8.2.0 Early Unlock) =================

const QUEUE_CACHE_KEY = 'SYSTEM_TASK_QUEUE';

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
        } else if (task.func === 'processCancelTask') {
          processCancelTask(task.data);
          console.log("✅ processCancelTask");
        } else if (task.func === 'processCreateEvent') {
          processCreateEvent(task.data);
          console.log("✅ processCreateEvent");
        }
      } catch (taskError) {
        console.error(`⚠️ 任務執行失敗 (${task.func}): ` + taskError.toString());
      }
    }
    console.log("✅ 所有任務執行完畢");
  }
}

function doProcessCreateLogAndNotify(d) {
  // 1. 取得試算表，若不存在則建立（防呆）
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(APPOINTMENT_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(APPOINTMENT_LOG);
    // 可選：初始化標題列
    sheet.appendRow(["紀錄時間", "Line ID", "客戶姓名", "電話", "預約日期時間", "課程名稱", "方案內容", "課程扣抵", "單次預約", "加時卷", "時長", "狀態"]);
  }

  // 2. 📝 精準對齊 12 欄位 (A 到 L)
  // 請確保傳入的 d 物件包含：courseDeduction, singleCount, ticketVal, serviceDuration
  sheet.appendRow([
    new Date(),               // A: 紀錄時間
    d.lineUserId,             // B: Line ID
    d.name,                   // C: 客戶姓名
    "'" + d.phone,            // D: 電話 (防變形)
    d.dateTime,               // E: 預約日期時間
    d.courseName,             // F: 課程名稱
    d.planContent,            // G: 方案內容
    d.courseDeduction,
    d.singleCount,               // H: 方案類型 (COURSE/SINGLE)
    d.ticketVal || 0,         // J: 加時卷 (1 或 0)
    d.serviceDuration,        // K: 時長 (純數字)
    "預約成功"                 // L: 狀態
  ]);

  // 3. --- LINE 通知發送 ---
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
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(APPOINTMENT_LOG);
  
  if (sheet) {
    // 📝 試算表欄位對齊：A 到 K 欄
    sheet.appendRow([
      new Date(),           // A: 紀錄執行時間
      d.lineUserId,         // B: LINE ID
      d.name,               // C: 姓名
      "'" + d.phone,        // D: 電話 (防變形)
      d.dateTimeStr,        // E: 預約時間
      d.realCourseName,     // F: 課程名稱
      d.customPlanName,     // G: 方案內容
      d.plan === 'COURSE' ? 1 : 0,               // H: 方案類型 (COURSE/SINGLE)
      d.plan === 'SINGLE' ? 1 : 0,               // H: 方案類型 (COURSE/SINGLE)
      d.useTicket ? "1" : "0", // I: 加時卷
      d.duration + "分",    // J: 分鐘數
      "已取消"              // K: 狀態
    ]);
  }

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