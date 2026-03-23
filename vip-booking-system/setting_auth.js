function grantTriggerPermission() {
  // 這行程式碼沒有實際作用，只是為了讓 Google 偵測到我們需要 Trigger 權限
  ScriptApp.newTrigger('doNothing').timeBased().after(1).create();
}

function doNothing() {}