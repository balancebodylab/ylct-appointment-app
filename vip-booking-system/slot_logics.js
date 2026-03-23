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
  let startH, endH;
  if (day === 1) { 
    startH = 10; endH = 17; 
  } else if (day === 0) {
    startH = 12; endH = 17;
  } else {
    startH = 14; endH = 22;
  }

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

  // --- 4. 特殊邏輯 A：早鳥連動 ---
  if (day >= 2 && day <= 6 && duration === 80) {
    const target1500Time = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 15, 0, 0).getTime();
    const hasBookingAt1500 = busyRanges.some(r => Math.abs(r.start - target1500Time) < 1000);

    if (hasBookingAt1500) {
      let sTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 13, 30, 0).getTime();
      let eTime = sTime + durationMs;
      
      if (sTime >= minBookingTime) {
         const isBusy = busyRanges.some(r => sTime < r.end && eTime > r.start);
         if (!isBusy) slots.push("13:30");
      }
    }
  }

  // --- 5. 休息區間設定 (優化：將時間預先轉為毫秒，避免在迴圈內重複計算) ---
  let activeWindows = [];
  if (day !== 1 && typeof PROTECTION_WINDOWS !== 'undefined') {
    activeWindows = PROTECTION_WINDOWS.map(w => ({
      startMs: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), w.start, 0, 0).getTime(),
      endMs: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), w.end, 0, 0).getTime()
    }));
  }

  const minMealDurationMs = (typeof MIN_MEAL_DURATION !== 'undefined' ? MIN_MEAL_DURATION : 30) * 60 * 1000;
  const limitTimeMs = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), endH, 0, 0).getTime();

  // --- 6. 標準時段掃描 ---
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += 30) {
      let sTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, m, 0).getTime();
      let eTime = sTime + durationMs;
      
      let isOvertime = eTime > limitTimeMs;
      
      // 特殊邏輯 B：夜間加班
      if (isOvertime && h === 21 && m === 0 && duration === 80) {    
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
            if (r.start - lastEnd >= minMealDurationMs) { hasSafeBreak = true; break; }
            lastEnd = Math.max(lastEnd, r.end);
          }
          if (!hasSafeBreak && (win.endMs - lastEnd >= minMealDurationMs)) hasSafeBreak = true;
          if (!hasSafeBreak) { violatesMealRule = true; break; }
        }
      }
      if (violatesMealRule) continue; 

      // 優化：拔除緩慢的 Utilities.formatDate，改用原生 JS 高速字串補零
      let timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      
      // 避免重複加入 (例如 13:30 在早鳥邏輯已經被加入過)
      if (!slots.includes(timeStr)) {
        slots.push(timeStr);
      }
    }
  }

  slots.sort();
  return { status: 'OK', slots: slots };
}