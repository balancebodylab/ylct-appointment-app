// ================= 分層效能測試 (Test.gs) =================

/**
 * 執行分層效能測試：前端回應時間 vs 後台處理時間
 */
function measureSplitPerformance() {
  console.log("🚀 開始執行「前端 vs 後台」分層測試...");
  
  // --- 1. 準備測試數據 ---
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const testDate = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const testTime = "13:00"; 
  const testPhone = "0900000000"; 
  const testName = "速度測試員";
  const testLineId = "U_TEST_SPEED"; 
  const testDuration = 50;

  // 用來儲存數據
  let t_frontend = 0;
  let t_background = 0;

  try {
    // ==========================================
    // 階段一：測試「前端回應速度」 (使用者等待時間)
    // ==========================================
    console.log(`⏱️ [1/2] 測試前端請求 (createBooking)...`);
    const t1 = new Date().getTime();
    
    // 這會執行：檢查快取 -> 寫入日曆 -> 排程背景任務 -> 回傳
    const res = createBooking(
      testDate, testTime, testDuration, testName, testPhone, testLineId, 
      'COURSE', false, '測試方案'
    );
    
    const t2 = new Date().getTime();
    t_frontend = t2 - t1;
    
    if (!res.success) throw new Error("預約失敗");
    console.log(`✅ 前端回應完成。耗時: ${t_frontend} ms`);


    // ==========================================
    // 階段二：測試「背景處理速度」 (寫Log + 發LINE)
    // ==========================================
    console.log(`⏱️ [2/2] 測試背景任務 (寫Sheet + 發LINE)...`);
    
    // 我們需要「模擬」背景任務接收到的資料包 (Task Data)
    // 這些資料通常是在 createBooking 內部組裝的，這裡我們手動組裝一次以進行測試
    const weekday = getDayOfWeekCN(testDate);
    const mockTaskData = {
      lineUserId: testLineId,
      name: testName,
      phone: testPhone,
      dateTime: testDate + ' ' + testTime,
      courseName: '測試課程',
      planContent: '測試方案',
      courseDeduction: 1,
      singleCount: 0,
      ticketVal: 0,
      serviceDuration: 40, // 扣除緩衝後
      adminMsg: `[測試] 管理員通知 - ${testName}`,
      userMsg: `[測試] 用戶通知 - ${testName}`
    };

    const t3 = new Date().getTime();
    // 直接呼叫 AsyncWorker.gs 裡面的實作函式
    doProcessCreateLogAndNotify(mockTaskData);
    const t4 = new Date().getTime();
    t_background = t4 - t3;
    console.log(`✅ 背景處理完成。耗時: ${t_background} ms`);


    // ==========================================
    // 📊 最終報告
    // ==========================================
    console.log("\n=====================================");
    console.log("       ⚡️ 速度差異分析報告       ");
    console.log("=====================================");
    console.log(`1️⃣ 使用者等待時間 (Frontend):  ${t_frontend} ms  (極快!)`);
    console.log(`2️⃣ 系統後台運算 (Background):  ${t_background} ms  (較慢，但不影響用戶)`);
    console.log("-------------------------------------");
    console.log(`💡 結論：您成功節省了用戶 ${t_background} ms 的等待時間！`);
    console.log("=====================================\n");

    // 為了不影響測試數據，這裡我們簡單呼叫就好，不計入報告
    const t5 = new Date().getTime();
    const history = getBookingHistory(testPhone);
    const t6 = new Date().getTime();
    t_background = t6- t5;
    console.log(`✅ getBookingHistory: ${t_background} ms`);
    if(history.bookings.length > 0) {
      cancelBooking(history.bookings[0].id, testPhone, testName, testLineId);
    }

  } catch (e) {
    console.error("❌ 測試錯誤: " + e.toString());
  }
}
function measureLoginPerformance() {
  const testPhone = "0932871413"; // 請換成您 Sheet 裡有的真實電話
  
  // 第一強迫清除該電話的快取，確保測試準確
  const cache = CacheService.getScriptCache();
  cache.remove('user_login_' + testPhone);
  
  console.log("--- 第一次呼叫 (應該讀取 Sheet) ---");
  const t1 = new Date().getTime();
  loginUser(testPhone);
  console.log(`第一次耗時: ${new Date().getTime() - t1} ms`);

  console.log("\n--- 第二次呼叫 (應該讀取快取) ---");
  const t2 = new Date().getTime();
  loginUser(testPhone);
  console.log(`第二次耗時: ${new Date().getTime() - t2} ms`);
}

/**
 * 測試日曆讀取速度 (比較「API 讀取」與「快取讀取」的差異)
 */
function measureCalendarReadSpeed() {
  console.log("🚀 開始測試日曆讀取效能 (getAvailableSlots)...");
  
  // 1. 準備測試參數 (查明天的空檔)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const testDate = Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const testDuration = 50;

  // 2. 強制清除日曆快取 (模擬冷啟動)
  // 對應 CalendarCache.gs 裡的 CACHE_KEY_CALENDAR
  const cache = CacheService.getScriptCache();
  cache.remove('CALENDAR_EVENTS_30DAYS'); 
  console.log("🧹 已清除日曆快取 (模擬第一次讀取)");

  // ==========================================
  // 階段一：第一次讀取 (Cache Miss)
  // ==========================================
  console.log(`\n⏱️ [第一次讀取] 正在呼叫 Google Calendar API...`);
  const t1 = new Date().getTime();
  
  const result1 = getAvailableSlots(testDate, testDuration);
  
  const t2 = new Date().getTime();
  const time1 = t2 - t1;
  console.log(`✅ 第一次耗時: ${time1} ms`);
  console.log(`   (狀態: ${result1.status}, 找到 ${result1.slots.length} 個時段)`);

  // ==========================================
  // 階段二：第二次讀取 (Cache Hit)
  // ==========================================
  console.log(`\n⏱️ [第二次讀取] 再次呼叫 (預期命中快取)...`);
  const t3 = new Date().getTime();
  
  const result2 = getAvailableSlots(testDate, testDuration);
  
  const t4 = new Date().getTime();
  const time2 = t4 - t3;
  console.log(`✅ 第二次耗時: ${time2} ms`);

  // ==========================================
  // 📊 分析報告
  // ==========================================
  console.log("\n=====================================");
  console.log("       📅 日曆讀取速度報告       ");
  console.log("=====================================");
  console.log(`1️⃣ 無快取 (API IO):  ${time1} ms`);
  console.log(`2️⃣ 有快取 (Memory):  ${time2} ms`);
  console.log("-------------------------------------");
  
  if (time2 < 50) {
    console.log(`🚀 狀態：快取運作完美！(加速約 ${Math.round(time1 / time2)} 倍)`);
  } else {
    console.log(`⚠️ 狀態：快取似乎未生效，請檢查 CalendarCache.gs`);
  }
  console.log("=====================================\n");
}

/**
 * 🛠️ [開發專用] 直接在編輯器內模擬 doPost
 * 執行這個函式， Log 會直接顯示在下方，不用去翻執行項目。
 */
function debugDoPost() {
  console.log("🐞 開始模擬 doPost 請求...");

  // 1. 準備模擬資料 (這裡是建立預約的範例)
  // 您可以隨時修改這裡的參數來測試不同情境
  const mockPayload = {
    action: "createBooking",
    date: "2026-03-15",      // 測試日期
    time: "14:00",           // 測試時間
    duration: 50,
    name: "測試員(Debug)",
    phone: "0900111222",
    lineUserId: "U_DEBUG_USER",
    plan: "COURSE",
    useTicket: false,
    customPlanName: "Debug方案",
    realCourseName: "2025方案"
  };

  // 2. 偽造 event 物件 (模擬 LINE 送過來的資料)
  const e = {
    postData: {
      contents: JSON.stringify(mockPayload)
    }
  };

  // 3. 直接呼叫 doPost (這樣 console.log 就會直接印在編輯器下方)
  const result = doPost(e);
  const t1 = new Date().getTime();
  processTaskQueue()
  const t2 = new Date().getTime();
  const time = t2 - t1;
  console.log(`✅ 背景耗時: ${time} ms`);
  console.log("-----------------------------");
  console.log("📝 回傳結果:", result.getContent());
  console.log("🐞 模擬結束");
}

// ==========================================
// 🧪 測試專用腳本 (Test.gs)
// ==========================================

function runLoginTests() {
  console.log("🚀 開始執行自動化登入測試...");
  
  // 產生一個隨機的假 Line ID，確保每次測試都是全新的
  const fakeLineId = "U4759c0a3230d30418fc42258558ff15b";
  
  // ==========================================
  // 測試 1：搜尋不存在的 Line ID (模擬全新訪客)
  // ==========================================
  console.log(`\n▶️ [測試 1] 嘗試用未註冊的 Line ID 登入: ${fakeLineId}`);
  const loginFailResult = loginByLine(fakeLineId,"晴");
  
  if (!loginFailResult.success) {
    console.log("✅ 測試 1 通過：系統正確擋下未註冊的使用者。訊息：" + loginFailResult.message);
  } else {
    console.error("❌ 測試 1 失敗：系統居然讓假帳號登入了！");
  }

  // ==========================================
  // 測試 2：執行註冊流程 (模擬訪客填寫資料)
  // ==========================================
  console.log("\n▶️ [測試 2] 模擬新會員註冊...");
  const fakeUser = {
    lineUserId: fakeLineId,
    name: "自動測試員",
    phone: "0999888777"
  };
  
  const registerResult = registerNewUser(fakeUser);
  
  if (registerResult.success && registerResult.user.name === "自動測試員") {
    console.log("✅ 測試 2 通過：註冊成功，回傳的使用者名稱正確！");
  } else {
    console.error("❌ 測試 2 失敗：註冊發生錯誤！", registerResult);
  }

  // 暫停 1 秒，確保 Google Sheet 已經寫入完畢
  Utilities.sleep(1000);

  // ==========================================
  // 測試 3：再次用剛剛註冊的 Line ID 登入 (模擬舊客回訪)
  // ==========================================
  console.log(`\n▶️ [測試 3] 嘗試用剛註冊的 Line ID 再次登入: ${fakeLineId}`);
  const loginSuccessResult = loginByLine(fakeLineId);
  
  if (loginSuccessResult.success && loginSuccessResult.user) {
    console.log("✅ 測試 3 通過：系統成功找到剛剛註冊的會員！資料如下：");
    console.log(loginSuccessResult.user);
  } else {
    console.error("❌ 測試 3 失敗：寫入試算表後，卻無法讀取到該會員！");
    console.log("💡 提示：請檢查您試算表的標題列是否有 'LineID' 這一欄。");
  }

  console.log("\n🎉 所有登入相關測試執行完畢！");
  console.log("⚠️ 提醒：請去您的 Google Sheet「會員資料」分頁，把剛剛產生的【自動測試員】那一行刪除。");
}

/**
 * 測試主程式：驗證 getBookingHistory 的篩選與快取邏輯
 */
function run_BookingHistoryTest() {
  const testPhone = "0912345678";
  const otherPhone = "0988777666";
  const cache = CacheService.getScriptCache();
  
  console.log("🧪 開始測試 getBookingHistory...");

  // 1. 【準備階段】手動注入模擬數據到大一統快取
  const mockEvents = [
    {
      i: "test_001",
      s: new Date("2026-03-01T14:00:00").getTime(),
      e: new Date("2026-03-01T15:00:00").getTime(),
      t: "[預約] 王小明",
      d: "方案內容：單次預約\n課程名稱：筋膜放鬆\n電話：" + testPhone
    },
    {
      i: "test_002",
      s: new Date("2026-03-02T10:00:00").getTime(),
      e: new Date("2026-03-02T11:00:00").getTime(),
      t: "[預約] 李大華",
      d: "方案內容：課程扣抵\n電話：" + otherPhone // 這是別人的預約
    },
    {
      i: "test_003",
      s: new Date("2026-03-05T16:00:00").getTime(),
      e: new Date("2026-03-05T17:30:00").getTime(),
      t: "[預約] 王小明 (回訪)",
      d: "方案內容：單次預約\n電話：" + testPhone
    },
    {
      i: "test_004",
      s: new Date("2026-03-10T12:00:00").getTime(),
      e: new Date("2026-03-10T13:00:00").getTime(),
      t: "工作室消毒日", // 這不是預約，不應被篩選出
      d: "不含電話資訊"
    }
  ];

  // 將模擬數據塞入 'CALENDAR_EVENTS_30DAYS'
  cache.put('CALENDAR_EVENTS_30DAYS', JSON.stringify(mockEvents), 600);
  console.log("✅ 模擬快取數據注入完成。");

  // 2. 【執行階段】呼叫 getBookingHistory
  const result = getBookingHistory(otherPhone);

  // 3. 【驗證階段】
  if (result.success) {
    const bookings = result.bookings;
    console.log(`📊 查詢結果：找到 ${bookings.length} 筆預約。`);

    // 驗證數量：應只有 2 筆符合 testPhone 且標題含 [預約]
    if (bookings.length === 2) {
      console.log("✅ 數量驗證：通過 (正確篩選出 2 筆)");
    } else {
      console.error(`❌ 數量驗證：失敗 (預期 2 筆，實際得到 ${bookings.length} 筆)`);
    }

    // 驗證內容：檢查第一筆的 ID 與 標題
    bookings.forEach((b, idx) => {
      console.log(`   第 ${idx + 1} 筆: ${b.start} - ${b.title}`);
    });

  } else {
    console.error("❌ 執行失敗：" + result.error);
  }

  console.log("🏁 測試結束。");
}


/**
 * 🛠️ 測試專用：模擬取消預約流程
 */
function run_CancelProcess() {
  console.log("🚀 開始測試：取消預約後端邏輯...");

  // 1. 模擬前端傳入的完整資料物件 (對齊你的 cancelData 順序)
  const mockCancelData = {
    eventId: "temp_test_123456",             // 模擬一個暫時 ID
    dateTimeStr: "2026-03-21 14:00",        // 模擬預約時間
    name: "測試員小青",
    phone: "0912345678",
    lineUserId: "U1234567890abcdef12345678", // 模擬 LINE ID
    duration: 50,
    plan: "COURSE",
    useTicket: false,
    customPlanName: "課程扣抵 (1堂 50分)",
    realCourseName: "2025 新年優惠 50 分鐘"
  };

  // 2. 測試場景 A：測試 temp_ ID 轉換 (手動塞入一個快取對照)
  // 假設這個 temp_ ID 對應到你日曆上某個真實存在的 eventId (請填入你日曆中現有的 ID 測試，或留空測試搜捕模式)
  const realIdInYourCalendar = "這裡可以換成你日曆上某個事件的 ID"; 
  CacheService.getScriptCache().put('MAP_' + mockCancelData.eventId, realIdInYourCalendar, 600);
  console.log("📍 已模擬快取對照表：temp_test_123456 -> " + realIdInYourCalendar);

  try {
    // 3. 直接執行背景任務函式
    console.log("⏳ 正在執行 processCancelTask...");
    processCancelTask(mockCancelData);

    console.log("✅ 測試執行完畢！請檢查以下項目：");
    console.log("1. 試算表 APPOINTMENT_LOG 是否新增了一橫列「已取消」紀錄？");
    console.log("2. 試算表中的 F 欄(課程) 與 G 欄(方案) 是否正確顯示文字？");
    console.log("3. 如果 ID 正確，Google 日曆上的事件是否已消失？");
    console.log("4. LINE 測試帳號或管理員是否收到取消通知？");

  } catch (e) {
    console.error("❌ 測試過程發生錯誤: " + e.toString());
  }
}