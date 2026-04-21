// ================= 時段計算邏輯 (SlotLogic) =================

/**
 * 核心排程運算函式
 */
function getAvailableSlots(dateStr, durationValue) {
  const now = new Date();
  // 強制設定為台灣時區，避免 GAS 伺服器時區偏移問題
  const selectedDate = new Date(dateStr + 'T00:00:00+08:00');
  const nextDay = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000);
  const day = selectedDate.getDay(); 

  // --- 1. 日期檢查 ---
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (selectedDate < todayStart) return { status: 'FULL', slots: [] }; 

  const currentMonth = now.getMonth();
  const targetMonth = selectedDate.getMonth();
  const targetYear = selectedDate.getFullYear();
  const currentYear = now.getFullYear();
  const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

  if (monthDiff > 1) return { status: 'FULL', slots: [], message: '尚未開放' };
  if (monthDiff === 1) {
    let lastDayOfCurrentMonth = new Date(currentYear, currentMonth + 1, 0);
    let lastWeekStart = new Date(lastDayOfCurrentMonth);
    lastWeekStart.setDate(lastDayOfCurrentMonth.getDate() - 7);
    if (now < lastWeekStart) return { status: 'FULL', slots: [], message: '下月預約於本月最後一週開放' };
  }

  // --- 2. 基礎營業時間 ---
  const businessHours = getBusinessHours(day);
  if (!businessHours.isOpen) return { status: 'FULL', slots: [] };
  const startH = businessHours.startH;
  const endH = businessHours.endH;

  // --- 3. 取得行程資料 ---
  const allEvents = getEventsWithCache(selectedDate, nextDay);
  const busyRanges = allEvents.map(e => ({ 
    start: e.getStartTime().getTime(), 
    end: e.getEndTime().getTime() 
  }));

  let slots = [];
  const duration = parseInt(durationValue);
  const durationMs = duration * 60 * 1000;
  const minBookingTime = now.getTime() + (60 * 60 * 1000); 
  const specialRules = getSpecialRules(day, duration);

  // --- 4. 特殊邏輯 A：早鳥連動 ---
  specialRules
    .filter(rule => rule.type === 'EARLY_BIRD' && rule.triggerCondition === '當日15:00已被預約')
    .forEach(rule => {
      const target1500Time = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 15, 0, 0).getTime();
      const hasBookingAt1500 = busyRanges.some(r => Math.abs(r.start - target1500Time) < 1000);
      const openSlot = parseSlotTime_(rule.openSlot);
      if (!openSlot) return;

      if (hasBookingAt1500) {
        let sTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), openSlot.hour, openSlot.minute, 0).getTime();
        let eTime = sTime + durationMs;

        if (sTime >= minBookingTime) {
          const isBusy = busyRanges.some(r => sTime < r.end && eTime > r.start);
          if (!isBusy && !slots.includes(rule.openSlot)) slots.push(rule.openSlot);
        }
      }
    });

  // --- 5. 休息區間設定 (優化：將時間預先轉為毫秒，避免在迴圈內重複計算) ---
  const activeWindows = getProtectionWindows(day).map(w => ({
    startMs: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), w.startH, w.startM, 0).getTime(),
    endMs: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), w.endH, w.endM, 0).getTime(),
    minGapMs: w.minGapMinutes * 60 * 1000
  }));

  const limitTimeMs = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), endH, 0, 0).getTime();
  const nightExtendSlots = specialRules
    .filter(rule => rule.type === 'NIGHT_EXTEND')
    .map(rule => rule.openSlot);

  // --- 6. 標準時段掃描 ---
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += 30) {
      let sTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, m, 0).getTime();
      let eTime = sTime + durationMs;
      
      let isOvertime = eTime > limitTimeMs;
      
      // 特殊邏輯 B：夜間加班
      if (isOvertime && nightExtendSlots.includes(formatSlotTime_(h, m))) {
        isOvertime = false; 
      }

      if (isOvertime || sTime < minBookingTime) continue; 

      // 碰撞測試
      const isBusy = busyRanges.some(r => sTime < r.end && eTime > r.start);
      if (isBusy) continue;

      // 用餐規則檢查
      let violatesMealRule = false;
      for (let win of activeWindows) {
        if (sTime < win.endMs && eTime > win.startMs) {
          let tempRanges = [...busyRanges, { start: sTime, end: eTime }];
          let rangesInWindow = tempRanges
            .filter(r => r.end > win.startMs && r.start < win.endMs)
            .map(r => ({ start: Math.max(r.start, win.startMs), end: Math.min(r.end, win.endMs) }))
            .sort((a, b) => a.start - b.start);

          let hasSafeBreak = false;
          let lastEnd = win.startMs;
          
          for (let r of rangesInWindow) {
            if (r.start - lastEnd >= win.minGapMs) { hasSafeBreak = true; break; }
            lastEnd = Math.max(lastEnd, r.end);
          }
          if (!hasSafeBreak && (win.endMs - lastEnd >= win.minGapMs)) hasSafeBreak = true;
          if (!hasSafeBreak) { violatesMealRule = true; break; }
        }
      }
      if (violatesMealRule) continue; 

      // 優化：拔除緩慢的 Utilities.formatDate，改用原生 JS 高速字串補零
      let timeStr = formatSlotTime_(h, m);
      
      // 避免重複加入 (例如 13:30 在早鳥邏輯已經被加入過)
      if (!slots.includes(timeStr)) {
        slots.push(timeStr);
      }
    }
  }

  nightExtendSlots.forEach(slot => {
    const openSlot = parseSlotTime_(slot);
    if (!openSlot || slots.includes(slot)) return;

    const sTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), openSlot.hour, openSlot.minute, 0).getTime();
    const eTime = sTime + durationMs;
    if (sTime < minBookingTime) return;

    const isBusy = busyRanges.some(r => sTime < r.end && eTime > r.start);
    if (!isBusy) slots.push(slot);
  });

  slots.sort();
  return { status: 'OK', slots: slots };
}

function parseSlotTime_(timeStr) {
  const match = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return {
    hour: parseInt(match[1], 10),
    minute: parseInt(match[2], 10)
  };
}

function formatSlotTime_(hour, minute) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}
