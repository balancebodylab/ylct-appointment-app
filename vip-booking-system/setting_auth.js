function grantTriggerPermission() {
  // 這行程式碼沒有實際作用，只是為了讓 Google 偵測到我們需要 Trigger 權限
  ScriptApp.newTrigger('doNothing').timeBased().after(1).create();
}

function doNothing() {}

function installCalendarCacheRefreshTriggers() {
  if (!CALENDAR_ID) {
    throw new Error('缺少 CALENDAR_ID，無法安裝日曆快取刷新觸發器');
  }

  const handlerName = 'onAppointmentCalendarEventUpdated';
  const triggers = ScriptApp.getProjectTriggers();
  let hasCalendarTrigger = false;
  let hasTimeTrigger = false;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() !== handlerName) return;

    const sourceId = trigger.getTriggerSourceId && trigger.getTriggerSourceId();
    if (sourceId === CALENDAR_ID) hasCalendarTrigger = true;
    if (!sourceId) hasTimeTrigger = true;
  });

  if (!hasCalendarTrigger) {
    ScriptApp.newTrigger(handlerName)
      .forUserCalendar(CALENDAR_ID)
      .onEventUpdated()
      .create();
  }

  if (!hasTimeTrigger) {
    ScriptApp.newTrigger(handlerName)
      .timeBased()
      .everyMinutes(15)
      .create();
  }

  return {
    calendarTriggerInstalled: !hasCalendarTrigger,
    timeTriggerInstalled: !hasTimeTrigger
  };
}
