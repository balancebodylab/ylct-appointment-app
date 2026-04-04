// Current Logic Version: v8.6 - Integrated Identity & Auto-binding
// ================= 主程式入口 (Main) =================
// 它是整個 API 的入口，負責分配工作。

function doPost(e) {
  // ⏱️ 全局計時開始
  const globalStart = new Date().getTime(); 
  
  try {
    // 1. 解析資料
    const parseStart = new Date().getTime();
    const data = JSON.parse(e.postData.contents);
    const action = data.action; 
    console.log(`[Request] 收到請求: ${action}`); // 記錄請求類型
    
    let result = {};
    const parseTime = new Date().getTime() - parseStart;

    // 2. 執行業務邏輯 (路由分配)
    const logicStart = new Date().getTime();
    
    switch (action) {
      case 'loginUser': 
        result = loginUser(data.phone); 
        break;
      case 'getAvailableSlots': 
        result = getAvailableSlots(data.date, data.duration); 
        break;
      case 'createBooking': 
        result = createBooking(data.date, data.time, data.duration, data.name, data.phone, data.lineUserId, data.plan, data.useTicket, data.customPlanName, data.realCourseName); 
        break;
      case 'getBookingHistory': 
        result = getBookingHistory(data.phone); 
        break;
      case 'cancelBooking': 
        result = cancelBooking(data); 
        break;
      case 'loginByLine':
        return ContentService.createTextOutput(JSON.stringify(loginByLine(data.lineUserId)));
      case 'registerNewUser':
        return ContentService.createTextOutput(JSON.stringify(registerNewUser(data)));
      case 'triggerQueueNow':
        processTaskQueue(); 
        return ContentService.createTextOutput(JSON.stringify({ success: true }));
      default: 
        result = { success: false, message: '未知的請求' };
    }

    const logicEnd = new Date().getTime();
    const logicDuration = logicEnd - logicStart;

    // 3. 準備回傳
    const output = ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    
    const globalEnd = new Date().getTime();
    const totalDuration = globalEnd - globalStart;

    // 📊 [重要] 輸出效能報告到 Cloud Logs
    console.log(`✅ [Perf] Action: ${action} | 邏輯耗時: ${logicDuration}ms | 總耗時: ${totalDuration}ms`);
    
    // 如果邏輯跑太久 (>1秒)，顯示警告
    if (logicDuration > 1000) {
      console.warn(`⚠️ [Slow] ${action} 執行過慢，請檢查該函式內部的 Sheet 讀寫或 API 呼叫`);
    }

    return output;

  } catch (error) {
    console.error("❌ doPost 發生錯誤: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * [暖機專用] 什麼都不做，只是為了讓系統保持清醒
 */
function wakeUpSystem() {
  console.log("☀️ 系統暖機中 (Keep-Warm)...");
  // 這裡可以隨便讀一個 Cache 或做個簡單運算
  CacheService.getScriptCache().get('WAKE_UP_TEST');
}