function debugSheetConnection() {
  console.log("🔍 開始測試試算表連線...");
  
  // 1. 檢查 ID 是否存在
  if (!SHEET_ID || SHEET_ID.includes('您的試算表ID')) {
    console.error("❌ 錯誤：SHEET_ID 尚未設定！請將程式碼最上方的 '您的試算表ID' 替換為真實的 ID。");
    return;
  }
  console.log("✅ SHEET_ID 格式看起來正常: " + SHEET_ID);

  try {
    // 2. 嘗試開啟試算表
    const ss = SpreadsheetApp.openById(SHEET_ID);
    console.log("✅ 成功連接試算表: " + ss.getName());

    // 3. 檢查 客戶資料總覽 工作表
    const sheet = ss.getSheetByName('客戶資料總覽');
    if (!sheet) {
      console.error("❌ 錯誤：找不到名為 '客戶資料總覽' 的工作表。請確認您的試算表下方分頁名稱是否正確。");
    } else {
      console.log("✅ 成功讀取 '客戶資料總覽' 工作表");
      
      // 4. 讀取一筆資料測試權限
      const data = sheet.getRange(1, 1, 1, 1).getValue();
      console.log("✅ 讀取測試成功，A1 儲存格內容: " + data);
      console.log("🎉 系統權限正常！您現在可以重新部署 Web App 了。");
    }
    
  } catch (e) {
    console.error("❌ 連線失敗: " + e.toString());
    console.log("請確認：\n1. ID 是否正確？\n2. 您是否有權限存取該試算表？\n3. 是否已點擊「執行」並完成授權？");
  }
}