
import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { html } from 'htm/preact';

const tg = window.Telegram?.WebApp;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = tg?.colorScheme === 'dark' || prefersDark;
const theme = {
  bg: isDark ? '#0f1419' : '#f0f4f8', bg2: isDark ? '#161e2e' : '#ffffff',
  surface: isDark ? '#1e293b' : '#f1f5f9', surfaceHover: isDark ? '#253449' : '#e2e8f0',
  text: isDark ? '#f1f5f9' : '#0f172a', text2: isDark ? '#94a3b8' : '#64748b',
  accent: '#38bdf8', accentSoft: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(14,165,233,0.12)',
  accentGlow: isDark ? 'rgba(56,189,248,0.3)' : 'rgba(14,165,233,0.2)',
  border: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.2)',
  success: '#34d399', warning: '#fbbf24', danger: '#f87171', love: '#f472b6', purple: '#a78bfa',
};
const BACKEND_URL = 'https://neuroflows-eta.vercel.app/'; // <-- ВСТАВЬТЕ URL вашего бэкенда (например: 'https://your-bot.vercel.app')
if (tg) { try { tg.ready(); tg.expand(); tg.enableClosingConfirmation();
  const r = document.documentElement.style;
  r.setProperty('--bg', theme.bg); r.setProperty('--bg2', theme.bg2); r.setProperty('--surface', theme.surface);
  r.setProperty('--surface-hover', theme.surfaceHover); r.setProperty('--text', theme.text); r.setProperty('--text2', theme.text2);
  r.setProperty('--accent', theme.accent); r.setProperty('--accent-soft', theme.accentSoft); r.setProperty('--accent-glow', theme.accentGlow);
  r.setProperty('--border', theme.border); r.setProperty('--success', theme.success); r.setProperty('--warning', theme.warning);
  r.setProperty('--danger', theme.danger); r.setProperty('--love', theme.love); r.setProperty('--purple', theme.purple);
  r.setProperty('--tg-bg', theme.bg); r.setProperty('--tg-secondary-bg', theme.bg2); r.setProperty('--tg-text', theme.text);
  r.setProperty('--tg-hint', theme.text2); r.setProperty('--tg-button', theme.accent); r.setProperty('--tg-button-text', '#ffffff');
} catch(e) { console.error(e); } }

const KEY = 'nf_v2';
const TUTORIAL_KEY = 'nf_tutorial_v2';
let subs = [];
const DEFAULT_PALETTE = {menstruation:'#EF4444',follicular:'#EC4899',fertile:'#FBBF24',ovulation:'#38BDF8',luteal:'#6366F1',pms:'#A8A29E'};
const PRESETS = {
  default: { name: 'Стандартная', ...DEFAULT_PALETTE },
  warm: { name: 'Тёплая', menstruation:'#F87171', follicular:'#FB923C', fertile:'#FBBF24', ovulation:'#FACC15', luteal:'#F59E0B', pms:'#A8A29E' },
  cool: { name: 'Холодная', menstruation:'#F43F5E', follicular:'#06B6D4', fertile:'#22D3EE', ovulation:'#3B82F6', luteal:'#8B5CF6', pms:'#94A3B8' },
  pastel: { name: 'Пастельная', menstruation:'#FDA4AF', follicular:'#F0ABFC', fertile:'#FDE68A', ovulation:'#7DD3FC', luteal:'#C4B5FD', pms:'#D6D3D1' },
};
let state = {
  profile: null, logs: {}, lastPeriodStart: null, currentProfile: null, draftLog: null, tutorialSeen: false,
  taskChecks: {}, customTasks: { work: [], body: [], food: [] },
  palette: { ...DEFAULT_PALETTE }, paletteName: 'default',
  notifSettings: { periodReminder: 3, ovulationAlert: true, pmsAlert: true, time: '09:00' },
  coachMarksSeen: {},
};

const cloud = {
  set: (k, v) => new Promise((res) => tg?.CloudStorage?.setItem(k, v, () => res())),
  get: (k) => new Promise((res) => tg?.CloudStorage?.getItem(k, (e, v) => res(e ? null : v))),
};

async function loadState() {
  try {
    const v1raw = localStorage.getItem('nf_v1');
    if (v1raw && !localStorage.getItem(KEY)) { const v1 = JSON.parse(v1raw); state = { ...state, ...v1 }; localStorage.setItem(KEY, JSON.stringify(state)); localStorage.removeItem('nf_v1'); }
  } catch(e) {}
  try {
    let raw = null;
    if (tg?.CloudStorage) raw = await cloud.get(KEY);
    if (!raw) raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    state.tutorialSeen = localStorage.getItem(TUTORIAL_KEY) === 'true';
  } catch(e) {}
}

const saveStore = async () => {
  const s = JSON.stringify(state);
  localStorage.setItem(KEY, s);
  if (tg?.CloudStorage) await cloud.set(KEY, s);
};
const pub = () => subs.forEach(cb => cb(state));
const store = {
  getState: () => state,
  sub: cb => { subs.push(cb); return () => { subs = subs.filter(c => c !== cb); }; },
  setProfile: p => { state.profile = p; saveStore(); pub(); },
  setLps: d => { state.lastPeriodStart = d; saveStore(); compute(); pub(); },
  addLog: log => {
    const { profile, lastPeriodStart } = state;
    if (log.isPeriod && profile && lastPeriodStart) {
      const stMs = new Date(lastPeriodStart + 'T00:00:00').getTime();
      const logMs = new Date(log.date + 'T00:00:00').getTime();
      const rawDay = Math.floor((logMs - stMs) / 86400000) + 1;
      if (rawDay > (profile.averagePeriodLength || 5)) { state.lastPeriodStart = log.date; }
    }
    state.logs[log.date] = log;
    recalcAverageCycle();
    saveStore(); compute(); pub();
  },
  setDraft: log => { state.draftLog = log; saveStore(); pub(); },
  clearDraft: () => { state.draftLog = null; saveStore(); pub(); },
  markTutorial: () => { state.tutorialSeen = true; localStorage.setItem(TUTORIAL_KEY, 'true'); pub(); },
  resetAll: () => { localStorage.removeItem(KEY); localStorage.removeItem(TUTORIAL_KEY); if (tg?.CloudStorage) tg.CloudStorage.removeItem(KEY); location.reload(); },
  toggleTaskCheck: (date, tab, id) => {
    const dayChecks = { ...(state.taskChecks[date] || {}) };
    const tabChecks = { ...(dayChecks[tab] || {}) };
    tabChecks[id] = !tabChecks[id]; dayChecks[tab] = tabChecks;
    state.taskChecks = { ...state.taskChecks, [date]: dayChecks };
    saveStore(); pub();
  },
  addCustomTask: (tab, text) => { if (!text.trim()) return; const newTask = { id: 'c' + Date.now() + Math.random().toString(36).slice(2,6), text: text.trim() }; state.customTasks = { ...state.customTasks, [tab]: [...(state.customTasks[tab] || []), newTask] }; saveStore(); pub(); },
  removeCustomTask: (tab, id) => { state.customTasks = { ...state.customTasks, [tab]: (state.customTasks[tab] || []).filter(t => t.id !== id) }; saveStore(); pub(); },
  setPalette: (palette, presetName='custom') => { state.palette = { ...palette }; state.paletteName = presetName; saveStore(); pub(); },
  resetPalette: () => { state.palette = { ...DEFAULT_PALETTE }; state.paletteName = 'default'; saveStore(); pub(); },
  setNotifSettings: s => {
    state.notifSettings = { ...state.notifSettings, ...s };
    saveStore(); pub();
    if (BACKEND_URL && tg?.initDataUnsafe?.user?.id) {
      fetch(`${BACKEND_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tg.initDataUnsafe.user.id, settings: state.notifSettings })
      }).catch(() => {});
    }
  },
  markCoachMark: id => { state.coachMarksSeen = { ...state.coachMarksSeen, [id]: true }; saveStore(); pub(); },
  exportCSV: () => {
    const rows = [['date','isPeriod','symptoms','energyLevel','focusLevel','anxietyLevel','sleepQuality','mood','cervicalMucus']];
    Object.values(state.logs).sort((a,b)=>a.date<b.date?-1:1).forEach(l => {
      rows.push([l.date, l.isPeriod?'1':'0', (l.symptoms||[]).join(';'), l.energyLevel??'', l.focusLevel??'', l.anxietyLevel??'', l.sleepQuality??'', l.mood??'', l.cervicalMucus??'']);
    });
    return rows.map(r => r.map(c => `\"${String(c).replace(/\"/g,'\"\"')}\"`).join(',')).join('\n');
  },
};

const NE = {
  getEstrogen(d, L=28) { const ov=L-14; return d<=ov ? Math.exp(-Math.pow(d-ov,2)/10) : 0.3+0.4*Math.exp(-Math.pow(d-(ov+7),2)/15); },
  getProgesterone(d, L=28) { const ov=L-14; return d<=ov ? 0.05 : Math.max(0, Math.sin((Math.PI*(d-ov))/14)); },
  getTestosterone(d, L=28) { const ov=L-14; return Math.exp(-Math.pow(d-ov,2)/4); },
  cns(e, p, s=4) { let b=e*0.6-p*0.3+0.5; return Math.min(100, Math.max(0, b*50+s*10)); },
  phase(d, L=28) { const ov=L-14; if(d<=5)return'menstruation'; if(d<ov)return'follicular'; if(d===ov)return'ovulation'; return'luteal'; },
  fertility(d, L=28) {
    const ov = L-14; const daysBefore = ov - d;
    if (daysBefore >= 0 && daysBefore <= 5) { if (daysBefore <= 1) return 'high'; if (daysBefore <= 3) return 'medium'; return 'low'; }
    if (d === ov + 1) return 'high';
    return null;
  },
  dayOf(lps, L=28) { const st=new Date(lps+'T00:00:00').getTime(); const now=Date.now(); const diff=Math.floor((now-st)/(86400000)); const day=diff+1; return day>0?day:1; },
  prof(day, L=28, sleep=4) { const e=this.getEstrogen(day,L); const p=this.getProgesterone(day,L); const t=this.getTestosterone(day,L); return {estrogen:e, progesterone:p, testosterone:t, cnsCapacity:this.cns(e,p,sleep), phase:this.phase(day,L), dayOfCycle:day}; },
  pc(ph) { return {menstruation:'#EF4444',follicular:'#EC4899',ovulation:'#38BDF8',luteal:'#6366F1'}[ph]; },
  pn(ph) { return {menstruation:'Менструация',follicular:'Фолликулярная',ovulation:'Овуляция',luteal:'Лютеиновая'}[ph]; },
  dcat(d, L=28) {
    const ov = L - 14; const ph = this.phase(d, L);
    if (ph === 'menstruation' || ph === 'ovulation') return ph;
    const fert = this.fertility(d, L);
    if (fert && d !== ov) return 'fertile';
    if (ph === 'luteal' && d >= L - 3 && d <= L) return 'pms';
    return ph;
  },
  dc(cat) { return (state.palette && state.palette[cat]) || DEFAULT_PALETTE[cat]; },
  dn(cat) { return {menstruation:'Менструация',follicular:'Фолликулярная',fertile:'Фертильное окно',ovulation:'Овуляция',luteal:'Лютеиновая',pms:'ПМС'}[cat]; },
  insight(ph, day) { const map={menstruation:'Обычно в этой фазе прогестерон и эстроген низкие. Энергия может быть снижена — хорошее время для восстановления ЦНС.',follicular:'Обычно в этой фазе эстроген растёт. Многие отмечают прилив сил для новых проектов и обучения.',ovulation:'Обычно в этой фазе (день '+day+') тестостерон и эстроген высокие. У многих растёт уверенность и коммуникабельность.',luteal:'Обычно в этой фазе прогестерон доминирует. Хорошее время для глубокого фокуса, но возможна повышенная чувствительность.'}; return map[ph]; },
  work(ph) { return {menstruation:'Рутинные задачи, планирование',follicular:'Новые проекты, обучение, переговоры',ovulation:'Публичные выступления, продажи, нетворкинг',luteal:'Глубокий анализ, завершение задач'}[ph]; },
  sport(ph) { return {menstruation:'Пилатес, йога, растяжка',follicular:'Кроссфит, бег, силовые',ovulation:'HIIT, танцы, командный спорт',luteal:'Йога, плавание, низкая интенсивность'}[ph]; },
  food(ph) { return {menstruation:'Железо, витамин C, тёплая еда',follicular:'Белок, зелень, пробиотики',ovulation:'Овощи, антиоксиданты, омега-3',luteal:'Сложные углеводы, магний, витамин B6'}[ph]; },
  intim(ph) { return {menstruation:'Обычно в этой фазе: реактивное либидо, потребность в нежности',follicular:'Обычно в этой фазе: спонтанное желание, openness к экспериментам',ovulation:'Обычно в этой фазе: пик либидо, максимальная фертильность',luteal:'Обычно в этой фазе: мягкость, потребность в эмоциональной близости'}[ph]; },
};

function dayOfCycleForDate(date, lps, cycleLength) {
  if (!lps || !cycleLength) return null;
  const st = new Date(lps + 'T00:00:00').getTime();
  const dt = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.floor((dt - st) / 86400000);
  if (diff < 0) return null;
  const day = (diff % cycleLength) + 1;
  return day > 0 ? day : 1;
}

function recalcAverageCycle() {
  const { logs, profile } = state; if (!profile) return;
  const periodDates = Object.entries(logs).filter(([_,l])=>l.isPeriod).map(([d])=>d).sort();
  if (periodDates.length < 2) return;
  const cycleStarts = []; let cur = periodDates[0];
  for (let i=1;i<periodDates.length;i++) { const diff = Math.round((new Date(periodDates[i])-new Date(periodDates[i-1]))/86400000); if (diff>1) { cycleStarts.push(cur); cur = periodDates[i]; } }
  if (cur) cycleStarts.push(cur);
  const lengths = [];
  for (let i=0;i<cycleStarts.length-1;i++) lengths.push(Math.round((new Date(cycleStarts[i+1])-new Date(cycleStarts[i]))/86400000));
  const valid = lengths.filter(l=>l>=21&&l<=35);
  if (valid.length>0) { const avg = Math.round(valid.reduce((a,b)=>a+b,0)/valid.length); if (avg!==profile.averageCycleLength) profile.averageCycleLength = avg; }
}

function compute() {
  const { profile, lastPeriodStart } = state;
  if (!profile || !lastPeriodStart) return;
  const day = NE.dayOf(lastPeriodStart, profile.averageCycleLength);
  const y = new Date(); y.setDate(y.getDate()-1);
  const yk = localISO(y); const ylog = state.logs[yk];
  state.currentProfile = NE.prof(day, profile.averageCycleLength, ylog?.sleepQuality ?? 4);
  saveStore();
}

function initStore(id) {
  if (!state.profile) { state.profile = { tgId: id, averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14, neuroSensitivity: 'medium', onContraception: false }; saveStore(); }
  compute();
}

const haptic = (t='light') => tg?.HapticFeedback?.impactOccurred?.(t);
const notify = (t='success') => tg?.HapticFeedback?.notificationOccurred?.(t);
function localISO(d) { const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
const todayStr = () => localISO(new Date());
const isSameDay = (a,b) => a.getDate()===b.getDate() && a.getMonth()===b.getMonth() && a.getFullYear()===b.getFullYear();

function Scrollable({ children, style }) {
  return html`<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;${style||''}">${children}</div>`;
}
function Card({ children, style, glow }) {
  const glowStyle = glow ? `box-shadow:0 0 24px ${theme.accentGlow};` : '';
  return html`<div style="border-radius:20px;padding:20px;background:var(--surface);border:1px solid var(--border);${glowStyle}${style||''}" class="anim">${children}</div>`;
}
function Button({ children, onClick, disabled, variant='primary', style }) {
  const variants = {
    primary: `background:linear-gradient(135deg,var(--accent),#0ea5e9);color:#fff;box-shadow:0 4px 20px ${theme.accentGlow};`,
    secondary: `background:var(--surface);color:var(--text);border:1px solid var(--border);`,
    ghost: `background:transparent;color:var(--text2);`,
    danger: `background:${theme.danger}18;color:${theme.danger};border:1px solid ${theme.danger}35;`,
    love: `background:${theme.love}15;color:${theme.love};border:1px solid ${theme.love}30;`,
  };
  return html`<button onClick=${onClick} disabled=${disabled} style="padding:14px 20px;border-radius:16px;border:none;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s;width:100%;${variants[variant]}${style||''}" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.96)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}>${children}</button>`;
}

function useTgBackButton(visible, onClick) {
  useEffect(() => {
    if (!tg?.BackButton) return;
    if (visible) { tg.BackButton.show(); tg.BackButton.onClick(onClick); }
    else { tg.BackButton.hide(); tg.BackButton.offClick(onClick); }
    return () => { tg.BackButton.hide(); tg.BackButton.offClick(onClick); };
  }, [visible, onClick]);
}
function useTgMainButton(text, visible, onClick, color, textColor) {
  useEffect(() => {
    if (!tg?.MainButton) return;
    tg.MainButton.setText(text);
    if (color) tg.MainButton.setParams({ color, text_color: textColor || '#ffffff' });
    if (visible) { tg.MainButton.show(); tg.MainButton.onClick(onClick); }
    else { tg.MainButton.hide(); tg.MainButton.offClick(onClick); }
    return () => { tg.MainButton.hide(); tg.MainButton.offClick(onClick); };
  }, [text, visible, onClick, color, textColor]);
}

function CustomDatePicker({ value, onSelect, onClose }) {
  const [viewDate, setViewDate] = useState(() => value ? new Date(value) : new Date());
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const selectDay = (day) => { const d = new Date(year, month, day); haptic('medium'); onSelect(localISO(d)); onClose(); };
  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const weekDays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const selectedDay = value ? new Date(value).getDate() : null;
  const selectedMonth = value ? new Date(value).getMonth() : null;
  const isSelectedMonth = selectedMonth === month;
  const today = new Date(); const todayDay = today.getDate(); const todayMonth = today.getMonth(); const todayYear = today.getFullYear();
  return html`
    <div style="position:fixed;inset:0;z-index:100;background:rgba(0,0,0,0.5);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn 0.2s ease;" onClick=${onClose}>
      <div style="background:var(--bg2);border-radius:28px;padding:28px;width:100%;max-width:380px;border:1px solid var(--border);box-shadow:0 32px 64px rgba(0,0,0,0.4);animation:fadeInScale 0.3s ease;" onClick=${e=>e.stopPropagation()}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
          <button onClick=${prevMonth} style="background:var(--surface);border:none;border-radius:12px;width:40px;height:40px;color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.9)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}>‹</button>
          <div style="font-size:17px;font-weight:700;color:var(--text);">${months[month]} ${year}</div>
          <button onClick=${nextMonth} style="background:var(--surface);border:none;border-radius:12px;width:40px;height:40px;color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.9)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}>›</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:10px;">${weekDays.map(d=>html`<div key=${d} style="text-align:center;font-size:11px;color:var(--text2);padding:10px 0;font-weight:600;">${d}</div>`)}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;">
          ${days.map((d,i)=>{
            if (!d) return html`<div key=${i} />`;
            const isSelected = isSelectedMonth && d === selectedDay;
            const isToday = d===todayDay && month===todayMonth && year===todayYear;
            return html`<button key=${i} onClick=${()=>selectDay(d)} style="aspect-ratio:1;border-radius:14px;border:none;background:${isSelected?'var(--accent)':isToday?'var(--accent-soft)':'transparent'};color:${isSelected?'#fff':isToday?'var(--accent)':'var(--text)'};font-size:14px;font-weight:600;cursor:pointer;transition:all 0.15s;position:relative;" onMouseOver=${e=>!isSelected&&(e.currentTarget.style.background='var(--surface-hover)')} onMouseOut=${e=>!isSelected&&(e.currentTarget.style.background='transparent')}>${d}${isToday&&!isSelected&&html`<div style="position:absolute;bottom:6px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--accent);" />`}</button>`;
          })}
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button onClick=${onClose} style="flex:1;padding:12px;border-radius:14px;border:none;background:var(--surface);color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;">Отмена</button>
          ${value&&html`<button onClick=${()=>{onSelect('');onClose();}} style="padding:12px 16px;border-radius:14px;border:none;background:${theme.danger}15;color:${theme.danger};font-size:14px;font-weight:600;cursor:pointer;">Удалить</button>`}
        </div>
      </div>
    </div>
  `;
}

function Tutorial({ onComplete }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: '🧠', title: 'Добро пожаловать', text: 'NeuroFlow понимает твою нейро-гормональную биологию и адаптирует рекомендации под твой цикл.' },
    { icon: '📊', title: 'Главный экран', text: 'Следи за фазой цикла, уровнем гормонов и загрузкой ЦНС. Всё визуализировано красиво и понятно.' },
    { icon: '📅', title: 'Календарь и планер', text: 'Получай рекомендации по работе, спорту и питанию. В календаре весь цикл в цветах.' },
    { icon: '✨', title: 'Ежедневный чек-ин', text: 'Отмечай самочувствие и симптомы. Чем больше данных — тем точнее персональные прогнозы.' },
  ];
  const next = () => { haptic('light'); if (step < steps.length - 1) setStep(step + 1); else { store.markTutorial(); onComplete(); } };
  const skip = () => { haptic('light'); store.markTutorial(); onComplete(); };
  const s = steps[step];
  return html`
    <div style="position:fixed;inset:0;z-index:200;background:var(--bg);display:flex;flex-direction:column;justify-content:center;padding:28px;gap:40px;animation:fadeIn 0.4s ease;">
      <div style="text-align:center;" class="anim">
        <div style="font-size:72px;margin-bottom:20px;filter:drop-shadow(0 12px 24px rgba(0,0,0,0.3));animation:pulse 3s ease infinite;">${s.icon}</div>
        <h2 style="font-size:26px;font-weight:800;color:var(--text);margin-bottom:14px;letter-spacing:-0.02em;">${s.title}</h2>
        <p style="font-size:16px;color:var(--text2);line-height:1.7;max-width:320px;margin:0 auto;">${s.text}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;max-width:340px;margin:0 auto;width:100%;">
        <div style="display:flex;justify-content:center;gap:8px;margin-bottom:4px;">${steps.map((_,i)=>html`<div key=${i} style="width:${i===step?28:8}px;height:8px;border-radius:999px;background:${i===step?'var(--accent)':'var(--surface-hover)'};transition:all 0.4s cubic-bezier(0.16,1,0.3,1);" />`)}</div>
        <${Button} onClick=${next}>${step < steps.length - 1 ? 'Далее' : 'Начать'}<//>
        ${step < steps.length - 1 && html`<button onClick=${skip} style="background:none;border:none;color:var(--text2);font-size:14px;padding:10px;cursor:pointer;font-weight:500;">Пропустить</button>`}
      </div>
    </div>
  `;
}

function Onboarding() {
  const [date, setDate] = useState('');
  const [cycle, setCycle] = useState(28);
  const [period, setPeriod] = useState(5);
  const [showPicker, setShowPicker] = useState(false);
  const start = () => {
    if (!date) return; haptic('medium');
    const p = store.getState().profile;
    if (p) store.setProfile({ ...p, averageCycleLength: cycle, averagePeriodLength: period });
    store.setLps(date);
    if (BACKEND_URL && tg?.initDataUnsafe?.user?.id) {
      fetch(`${BACKEND_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tg.initDataUnsafe.user.id, settings: store.getState().notifSettings })
      }).catch(() => {});
    }
    notify('success');
  };
  const formatDate = (d) => { if (!d) return ''; const [y,m,day] = d.split('-'); return `${day}.${m}.${y}`; };
  useTgMainButton('Начать', !!date, start, theme.accent, '#ffffff');
  return html`
    <div style="min-height:100vh;padding:28px 20px;display:flex;flex-direction:column;justify-content:center;gap:32px;background:var(--bg);color:var(--text);position:relative;">
      <div style="text-align:center;margin-bottom:4px;" class="anim">
        <div style="font-size:60px;margin-bottom:16px;filter:drop-shadow(0 12px 32px rgba(56,189,248,0.25));display:inline-block;animation:float 3s ease-in-out infinite;">🧠</div>
        <h1 style="font-size:34px;font-weight:800;margin-bottom:10px;background:linear-gradient(135deg,var(--accent),#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.02em;">NeuroFlow</h1>
        <p style="font-size:15px;color:var(--text2);line-height:1.6;max-width:300px;margin:0 auto;">Трекер цикла, который подстраивается под твою нейро-гормональную биологию</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;max-width:380px;margin:0 auto;width:100%;" class="anim">
        <div>
          <label style="font-size:14px;font-weight:600;display:block;margin-bottom:10px;color:var(--text2);">Дата начала последней менструации</label>
          <button onClick=${()=>setShowPicker(true)} style="width:100%;padding:16px 18px;border-radius:18px;border:2px solid ${date?'var(--accent)':'var(--border)'};background:var(--surface);color:var(--text);font-size:16px;text-align:left;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;font-weight:500;"><span>${date?formatDate(date):'Выберите дату'}</span><span style="font-size:22px;opacity:0.8;">📅</span></button>
        </div>
        <${Card}>
          <div style="font-size:14px;color:var(--text2);font-weight:500;margin-bottom:14px;">Длина цикла — обычно 26–30 дней</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:24px;">
            <button onClick=${()=>{haptic('light');setCycle(Math.max(21,cycle-1));}} style="width:48px;height:48px;border-radius:16px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:22px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
            <span style="font-size:32px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;min-width:64px;text-align:center;">${cycle}</span>
            <button onClick=${()=>{haptic('light');setCycle(Math.min(38,cycle+1));}} style="width:48px;height:48px;border-radius:16px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:22px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
          </div>
          ${(cycle<21||cycle>38)&&html`<div style="margin-top:12px;font-size:12px;color:${theme.danger};text-align:center;">Нестандартный цикл. Рекомендуем проконсультироваться с гинекологом</div>`}
        <//>
        <${Card}>
          <div style="font-size:14px;color:var(--text2);font-weight:500;margin-bottom:14px;">Длительность кровотечения — обычно 3–7 дней</div>
          <div style="display:flex;gap:6px;">${[3,4,5,6,7,8].map(n=>html`<button key=${n} onClick=${()=>{haptic('light');setPeriod(n);}} style="flex:1;height:44px;border-radius:12px;border:1.5px solid ${period===n?'var(--accent)':'var(--border)'};background:${period===n?'var(--accent)':'var(--surface-hover)'};color:${period===n?'#fff':'var(--text)'};font-size:15px;font-weight:700;cursor:pointer;transition:all 0.15s;">${n}</button>`)}</div>
        <//>
      </div>
      ${showPicker&&html`<${CustomDatePicker} value=${date} onSelect=${setDate} onClose=${()=>setShowPicker(false)} />`}
    </div>
  `;
}

function Dashboard({ onCheckIn }) {
  const [profile, setP] = useState(store.getState().currentProfile);
  const [palette, setPal] = useState(store.getState().palette);
  useEffect(() => store.sub(s => { setP(s.currentProfile); setPal(s.palette); }), []);
  if (!profile) return html`<div style="padding:40px 20px;color:var(--text2);text-align:center;font-size:15px;">Загрузка...</div>`;
  const c = palette[profile.phase] || NE.pc(profile.phase);
  const circ = 2 * Math.PI * 90;
  const profileState = store.getState().profile;
  const cycleLen = profileState?.averageCycleLength || 28;
  const offset = circ - (Math.min(profile.dayOfCycle, cycleLen) / cycleLen) * circ;
  const delayDays = profile.dayOfCycle - cycleLen;
  return html`
    <${Scrollable} style="padding:28px 20px 120px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;" class="anim">
        <div><h1 style="font-size:28px;font-weight:800;letter-spacing:-0.02em;">NeuroFlow</h1><p style="font-size:13px;color:var(--text2);margin-top:6px;font-weight:500;">Твой нейро-гормональный профиль</p></div>
        <button onClick=${onCheckIn} style="padding:10px 20px;border-radius:16px;border:none;background:linear-gradient(135deg,var(--accent),#0ea5e9);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px ${theme.accentGlow};transition:all 0.2s;display:flex;align-items:center;gap:6px;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.94)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}><span>✨</span> Чек-ин</button>
      </div>
      <div style="position:relative;width:260px;height:260px;margin:0 auto 32px;" class="anim-scale">
        <svg viewBox="0 0 200 200" style="width:100%;height:100%;filter:drop-shadow(0 0 30px ${c}18);">
          <defs><linearGradient id="dashGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color=${c} stop-opacity="0.85" /><stop offset="100%" stop-color=${c} stop-opacity="1" /></linearGradient></defs>
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="16" stroke="var(--surface)" />
          <circle cx="100" cy="100" r="90" fill="none" stroke="url(#dashGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray=${circ} stroke-dashoffset=${offset} transform="rotate(-90 100 100)" style="transition:stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1);" />
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:48px;font-weight:800;color:${c};font-variant-numeric:tabular-nums;text-shadow:0 0 40px ${c}35;transition:all 0.5s;">${profile.dayOfCycle}</div>
          <div style="font-size:14px;color:var(--text2);margin-top:6px;font-weight:500;">${NE.pn(profile.phase)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:8px;opacity:0.7;font-weight:500;background:var(--surface);padding:4px 12px;border-radius:20px;border:1px solid var(--border);">ЦНС: ${Math.round(profile.cnsCapacity)}%</div>
        </div>
      </div>
      ${delayDays>0&&html`<${Card} style="margin-bottom:18px;background:${theme.danger}10;border-color:${theme.danger}30;" class="anim"><div style="display:flex;align-items:center;gap:14px;"><div style="font-size:28px;">⏳</div><div><div style="font-size:15px;font-weight:800;color:${theme.danger};">Задержка ${delayDays} ${delayDays===1?'день':delayDays<5?'дня':'дней'}</div><div style="font-size:12px;color:var(--text2);margin-top:2px;">Менструация не началась в ожидаемый срок. Как только отметишь её в чек-ине — отсчёт цикла пересчитается автоматически.</div></div></div><//>`}
      <${Card} style="margin-bottom:18px;" class="anim">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:20px;">Уровень гормонов</div>
        ${[{n:'Эстроген',v:profile.estrogen,c:'#EC4899'},{n:'Прогестерон',v:profile.progesterone,c:'#8B5CF6'},{n:'Тестостерон',v:profile.testosterone,c:'#F59E0B'}].map((h,i)=>html`
          <div key=${i} style="margin-bottom:${i<2?'16px':'0'};">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:var(--text2);font-weight:500;">${h.n}</span><span style="color:${h.c};font-weight:800;font-variant-numeric:tabular-nums;">${Math.round(h.v*100)}%</span></div>
            <div style="height:12px;border-radius:999px;overflow:hidden;background:var(--bg);"><div style="height:100%;border-radius:999px;background:${h.c};width:${h.v*100}%;box-shadow:0 0 12px ${h.c}30;transition:width 1.2s ${i*0.15}s cubic-bezier(0.16,1,0.3,1);" /></div>
          </div>
        `)}
      <//>
      <${Card} style="margin-bottom:18px;background:${c}08;border-color:${c}25;" class="anim">
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="font-size:40px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.2));animation:float 3s ease-in-out infinite;">${profile.cnsCapacity>=80?'🚀':profile.cnsCapacity>=60?'⚡':profile.cnsCapacity>=40?'💡':profile.cnsCapacity>=20?'🌙':'🛌'}</div>
          <div><div style="font-size:16px;font-weight:800;color:${c};">${profile.cnsCapacity>=80?'Пик производительности':profile.cnsCapacity>=60?'Высокий ресурс':profile.cnsCapacity>=40?'Средний ресурс':profile.cnsCapacity>=20?'Низкий ресурс':'Восстановление'}</div><div style="font-size:12px;color:var(--text2);margin-top:4px;font-weight:500;">ЦНС загружен на ${Math.round(profile.cnsCapacity)}%</div></div>
        </div>
      <//>
      <${Card} class="anim"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Нейро-инсайт</div><p style="font-size:15px;line-height:1.7;color:var(--text);font-weight:500;">${NE.insight(profile.phase, profile.dayOfCycle)}</p><//>
    <//>
  `;
}

function TaskRow({ id, text, checked, onToggle, onRemove }) {
  return html`
    <${Card} style="display:flex;align-items:center;gap:14px;padding:16px 18px;transition:transform 0.15s;opacity:${checked?0.55:1};" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.98)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}">
      <button onClick=${()=>{haptic('medium');onToggle();}} style="width:26px;height:26px;border-radius:9px;border:2.5px solid ${checked?theme.success:'var(--border)'};background:${checked?theme.success:'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;transition:all 0.15s;padding:0;">${checked?html`<span style="color:#0f1419;font-size:15px;font-weight:900;line-height:1;">✓</span>`:''}</button>
      <span style="font-size:14px;color:var(--text);font-weight:500;flex:1;text-decoration:${checked?'line-through':'none'};">${text}</span>
      ${onRemove&&html`<button onClick=${()=>{haptic();onRemove();}} style="background:none;border:none;color:var(--text2);font-size:16px;cursor:pointer;padding:4px 6px;flex-shrink:0;">✕</button>`}
    <//>
  `;
}
function AddTaskInput({ onAdd }) {
  const [val, setVal] = useState('');
  const submit = () => { if (!val.trim()) return; onAdd(val); setVal(''); haptic('medium'); };
  return html`
    <div style="display:flex;gap:8px;">
      <input value=${val} onInput=${e=>setVal(e.target.value)} onKeyDown=${e=>{if(e.key==='Enter')submit();}} placeholder="Добавить своё..." style="flex:1;padding:14px 16px;border-radius:16px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;" />
      <button onClick=${submit} style="padding:0 20px;border-radius:16px;border:none;background:var(--accent);color:#fff;font-size:20px;font-weight:700;cursor:pointer;">+</button>
    </div>
  `;
}

function Planner() {
  const [tab, setTab] = useState('work');
  const [profile, setP] = useState(store.getState().currentProfile);
  const [checks, setChecks] = useState(store.getState().taskChecks);
  const [custom, setCustom] = useState(store.getState().customTasks);
  useEffect(() => store.sub(s => { setP(s.currentProfile); setChecks(s.taskChecks); setCustom(s.customTasks); }), []);
  if (!profile) return html`<div style="padding:40px 20px;color:var(--text2);text-align:center;">Загрузка...</div>`;
  const ph = profile.phase; const c = NE.pc(ph);
  const date = todayStr();
  const tabs = [{k:'work',l:'💼 Работа'},{k:'body',l:'💪 Тело'},{k:'food',l:'🥗 Питание'}];
  const isChecked = (t, id) => !!(checks[date]?.[t]?.[id]);
  const toggle = (t, id) => store.toggleTaskCheck(date, t, id);
  const builtinWork = {menstruation:['Ответить на отложенные письма','Обновить to-do','Провести ретроспективу','Организовать пространство'],follicular:['Запустить новый проект','Мозговой штурм','Изучить инструмент','Начать обучение'],ovulation:['Важные переговоры','Выступить на публике','Закрыть сделку','Нетворкинг'],luteal:['Завершить задачи','Аудит процессов','Написать документацию','Подготовить отчёты']}[ph];
  const builtinSport = {menstruation:['Пилатес 20 мин','Йога Нидра','Растяжка','Прогулка 30 мин'],follicular:['Кроссфит WOD','Бег 5 км','Силовая','Танцы'],ovulation:['HIIT 15 мин','Боевые искусства','Командный спорт','Плавание'],luteal:['Йога для ПМС','Плавание','Пилатес','Медитация в движении']}[ph];
  const builtinFood = {menstruation:[{n:'Говяжья печень',b:'Железо + B12'},{n:'Шпинат',b:'Фолиевая кислота'},{n:'Гранат',b:'Витамин C'},{n:'Тёплый бульон',b:'Уют и минералы'}],follicular:[{n:'Лосось',b:'Омега-3 + белок'},{n:'Брокколи',b:'Эстроген-детокс'},{n:'Кефир',b:'Пробиотики'},{n:'Авокадо',b:'Здоровые жиры'}],ovulation:[{n:'Помидоры',b:'Ликопен'},{n:'Орехи',b:'Цинк + селен'},{n:'Ягоды',b:'Антиоксиданты'},{n:'Оливковое масло',b:'Полифенолы'}],luteal:[{n:'Тёмный шоколад',b:'Магний'},{n:'Бананы',b:'Витамин B6'},{n:'Овсянка',b:'Сложные углеводы'},{n:'Чечевица',b:'Белок + железо'}]}[ph];
  return html`
    <${Scrollable} style="padding:28px 20px 120px;">
      <h1 style="font-size:28px;font-weight:800;margin-bottom:6px;letter-spacing:-0.02em;" class="anim">Планер</h1>
      <p style="font-size:13px;color:var(--text2);margin-bottom:24px;font-weight:500;" class="anim">Адаптация под текущую фазу — отмечай, что сделала, или добавляй своё</p>
      <div style="display:flex;gap:6px;padding:5px;border-radius:18px;background:var(--surface);border:1px solid var(--border);margin-bottom:28px;" class="anim">
        ${tabs.map(t=>html`<button key=${t.k} onClick=${()=>{haptic();setTab(t.k);}} style="flex:1;padding:10px 6px;border-radius:13px;border:none;background:${tab===t.k?'var(--accent)':'transparent'};color:${tab===t.k?'#fff':'var(--text2)'};font-size:13px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:${tab===t.k?`0 4px 16px ${theme.accentGlow}`:'none'};">${t.l}</button>`)}
      </div>
      <div style="animation:fadeIn 0.35s ease;">
        ${tab==='work'&&html`<div style="display:flex;flex-direction:column;gap:14px;"><${Card} glow style="border-color:${c}30;background:${c}08;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:${c};margin-bottom:8px;">Рекомендация фазы</div><div style="font-size:15px;color:var(--text);line-height:1.6;font-weight:500;">${NE.work(ph)}</div><//>${builtinWork.map((t,i)=>html`<${TaskRow} key=${'work_'+ph+'_'+i} id=${'work_'+ph+'_'+i} text=${t} checked=${isChecked('work','w_'+ph+'_'+i)} onToggle=${()=>toggle('work','w_'+ph+'_'+i)} />`)}${(custom.work||[]).map(ct=>html`<${TaskRow} key=${ct.id} id=${ct.id} text=${ct.text} checked=${isChecked('work',ct.id)} onToggle=${()=>toggle('work',ct.id)} onRemove=${()=>store.removeCustomTask('work',ct.id)} />`)}<${AddTaskInput} onAdd=${text=>store.addCustomTask('work',text)} /></div>`}
        ${tab==='body'&&html`<div style="display:flex;flex-direction:column;gap:14px;"><${Card} glow style="border-color:${c}30;background:${c}08;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:${c};margin-bottom:8px;">Спорт</div><div style="font-size:15px;color:var(--text);line-height:1.6;font-weight:500;">${NE.sport(ph)}</div><//>${builtinSport.map((t,i)=>html`<${TaskRow} key=${'sport_'+ph+'_'+i} id=${'sport_'+ph+'_'+i} text=${t} checked=${isChecked('body','s_'+ph+'_'+i)} onToggle=${()=>toggle('body','s_'+ph+'_'+i)} />`)}${(custom.body||[]).map(ct=>html`<${TaskRow} key=${ct.id} id=${ct.id} text=${ct.text} checked=${isChecked('body',ct.id)} onToggle=${()=>toggle('body',ct.id)} onRemove=${()=>store.removeCustomTask('body',ct.id)} />`)}<${AddTaskInput} onAdd=${text=>store.addCustomTask('body',text)} /><${Card} style="border-color:${theme.love}30;background:${theme.love}08;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:${theme.love};margin-bottom:8px;">Интимность</div><div style="font-size:15px;color:var(--text);line-height:1.6;font-weight:500;">${NE.intim(ph)}</div><//></div>`}
        ${tab==='food'&&html`<div style="display:flex;flex-direction:column;gap:14px;"><${Card} glow style="border-color:${c}30;background:${c}08;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:${c};margin-bottom:8px;">Питание фазы</div><div style="font-size:15px;color:var(--text);line-height:1.6;font-weight:500;">${NE.food(ph)}</div><//>${builtinFood.map((f,i)=>html`<${TaskRow} key=${'food_'+ph+'_'+i} id=${'food_'+ph+'_'+i} text=${f.n+' — '+f.b} checked=${isChecked('food','f_'+ph+'_'+i)} onToggle=${()=>toggle('food','f_'+ph+'_'+i)} />`)}${(custom.food||[]).map(ct=>html`<${TaskRow} key=${ct.id} id=${ct.id} text=${ct.text} checked=${isChecked('food',ct.id)} onToggle=${()=>toggle('food',ct.id)} onRemove=${()=>store.removeCustomTask('food',ct.id)} />`)}<${AddTaskInput} onAdd=${text=>store.addCustomTask('food',text)} /></div>`}
      </div>
    <//>
  `;
}

function DayDetailModal({ date, dayData, onClose }) {
  const d = new Date(date + 'T00:00:00');
  const log = dayData || {}; const hasData = !!dayData;
  return html`
    <div style="position:fixed;inset:0;z-index:120;background:rgba(0,0,0,0.6);backdrop-filter:blur(12px);display:flex;flex-direction:column;justify-content:flex-end;animation:fadeIn 0.2s ease;" onClick=${onClose}>
      <div style="background:var(--bg2);border-radius:28px 28px 0 0;padding:28px 20px 40px;border-top:1px solid var(--border);box-shadow:0 -16px 48px rgba(0,0,0,0.4);animation:slideUp 0.35s cubic-bezier(0.16,1,0.3,1);" onClick=${e=>e.stopPropagation()}>
        <div style="width:40px;height:5px;border-radius:999px;background:var(--surface-hover);margin:0 auto 20px;" />
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h3 style="font-size:20px;font-weight:800;">${d.getDate()} ${['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][d.getMonth()]} ${d.getFullYear()}</h3><button onClick=${onClose} style="background:var(--surface);border:none;border-radius:12px;width:36px;height:36px;color:var(--text);font-size:18px;cursor:pointer;">✕</button></div>
        ${!hasData&&html`<p style="color:var(--text2);text-align:center;padding:20px 0;">Нет записи за этот день</p>`}
        ${hasData&&html`
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${log.isPeriod&&html`<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;background:${theme.danger}15;border:1px solid ${theme.danger}30;"><span style="font-size:20px;">🩸</span><span style="font-weight:700;color:${theme.danger};">Менструация</span></div>`}
            ${log.symptoms?.length>0&&html`<div style="padding:12px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--border);"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Симптомы</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${log.symptoms.map(s=>html`<span key=${s} style="padding:5px 10px;border-radius:8px;background:var(--bg);font-size:12px;font-weight:600;color:var(--text);">${{cramps:'Спазмы',bloating:'Вздутие',headache:'Головная боль',breast_tenderness:'Чувств. груди',acne:'Высыпания',fatigue:'Усталость',insomnia:'Бессонница',cravings:'Тяга к сладкому'}[s]||s}</span>`)}</div></div>`}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${[{l:'Энергия',v:log.energyLevel,c:'#10B981'},{l:'Фокус',v:log.focusLevel,c:'#F59E0B'},{l:'Тревожность',v:log.anxietyLevel,c:'#EF4444'},{l:'Сон',v:log.sleepQuality,c:'#6366F1'}].map(m=>html`<div key=${m.l} style="padding:12px;border-radius:14px;background:var(--surface);border:1px solid var(--border);"><div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:600;">${m.l}</div><div style="font-size:18px;font-weight:800;color:${m.c};">${m.v}/5</div></div>`)}</div>
            ${log.mood&&html`<div style="padding:12px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:10px;"><span style="font-size:20px;">${{euphoric:'🤩',calm:'😌',irritated:'😤',sad:'😢',anxious:'😰',numb:'😶'}[log.mood]}</span><span style="font-weight:600;">${{euphoric:'Эйфория',calm:'Спокойствие',irritated:'Раздражение',sad:'Грусть',anxious:'Тревога',numb:'Апатия'}[log.mood]}</span></div>`}
            ${log.intimacy?.occurred&&html`<div style="padding:12px 16px;border-radius:14px;background:${theme.love}10;border:1px solid ${theme.love}25;"><div style="font-size:11px;font-weight:700;color:${theme.love};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Интимность</div><div style="font-size:14px;font-weight:600;">${log.intimacy.type==='partner'?'С партнёром':'Соло'} ${log.intimacy.orgasm?'✨':''} ${log.intimacy.discomfort?'⚠':''}</div></div>`}
            ${log.cervicalMucus&&log.cervicalMucus!=='dry'&&html`<div style="padding:12px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--border);"><div style="font-size:11px;color:var(--text2);font-weight:600;">Шейная слизь</div><div style="font-size:14px;font-weight:700;margin-top:4px;">${{dry:'Сухо',sticky:'Липкие',creamy:'Кремовые',egg_white:'Яичный белок'}[log.cervicalMucus]}</div></div>`}
          </div>
        `}
      </div>
    </div>
  `;
}

function CoachMark({ id, text, onDismiss }) {
  const [seen] = useState(store.getState().coachMarksSeen);
  if (seen[id]) return null;
  return html`<div onClick=${()=>{store.markCoachMark(id);onDismiss?.();}} style="position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:24px;cursor:pointer;"><div style="background:var(--surface);border:1px solid var(--accent);border-radius:18px;padding:18px 22px;max-width:280px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);"><div style="font-size:14px;color:var(--text);font-weight:600;line-height:1.5;">${text}</div><div style="font-size:11px;color:var(--text2);margin-top:10px;">Нажмите, чтобы закрыть</div></div></div>`;
}

function CycleChart() {
  const { logs, profile } = store.getState();
  const cycles = useMemo(() => {
    if (!profile) return [];
    const periodDates = Object.entries(logs).filter(([_,l])=>l.isPeriod).map(([d])=>d).sort();
    if (periodDates.length < 2) return [];
    const starts = []; let cur = periodDates[0];
    for (let i=1;i<periodDates.length;i++) { const diff = Math.round((new Date(periodDates[i])-new Date(periodDates[i-1]))/86400000); if (diff>1) { starts.push(cur); cur = periodDates[i]; } }
    if (cur) starts.push(cur);
    const lengths = [];
    for (let i=0;i<starts.length-1;i++) lengths.push(Math.round((new Date(starts[i+1])-new Date(starts[i]))/86400000));
    return lengths.map((l,i)=>({month:i+1,length:l})).slice(-12);
  }, [logs, profile]);
  if (cycles.length < 2) return html`<${Card} style="text-align:center;padding:32px;"><div style="font-size:36px;margin-bottom:12px;">📈</div><p style="color:var(--text2);font-size:14px;">Отметьте 2+ цикла, чтобы увидеть график</p><//>`;
  const w=340, h=160, pad=30;
  const maxL = Math.max(...cycles.map(c=>c.length), 35);
  const minL = Math.min(...cycles.map(c=>c.length), 21);
  const x = i => pad + (i / (cycles.length-1)) * (w - pad*2);
  const y = l => h - pad - ((l - minL) / (maxL - minL)) * (h - pad*2);
  const avg = cycles.reduce((a,c)=>a+c.length,0)/cycles.length;
  const pathD = cycles.map((c,i)=>`${i===0?'M':'L'} ${x(i)} ${y(c.length)}`).join(' ');
  return html`
    <${Card} style="margin-bottom:18px;" class="anim">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">График циклов</div>
      <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;">
        <line x1=${pad} y1=${y(avg)} x2=${w-pad} y2=${y(avg)} stroke="var(--text2)" stroke-dasharray="4 4" stroke-width="1" opacity="0.4" />
        <text x=${w-pad+4} y=${y(avg)+4} fill="var(--text2)" font-size="10" font-weight="600">ср. ${Math.round(avg)}</text>
        ${cycles.map((c,i)=>html`<circle key=${i} cx=${x(i)} cy=${y(c.length)} r="4" fill="var(--accent)" stroke="var(--bg2)" stroke-width="2" />`)}
        <path d=${pathD} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />
      </svg>
      <div style="display:flex;justify-content:space-between;margin-top:12px;">
        <span style="font-size:11px;color:var(--text2);font-weight:500;">Мин: ${Math.min(...cycles.map(c=>c.length))} дн</span>
        <span style="font-size:11px;color:var(--text2);font-weight:500;">Макс: ${Math.max(...cycles.map(c=>c.length))} дн</span>
      </div>
    <//>
  `;
}

function SymptomHeatmap() {
  const { logs, profile } = store.getState();
  const cycleLen = profile?.averageCycleLength || 28;
  const symptomKeys = ['cramps','bloating','headache','breast_tenderness','acne','fatigue','insomnia','cravings'];
  const symptomLabels = {cramps:'Спазмы',bloating:'Вздутие',headache:'Голова',breast_tenderness:'Грудь',acne:'Кожа',fatigue:'Усталость',insomnia:'Сон',cravings:'Тяга'};
  const data = useMemo(() => {
    const grid = {};
    symptomKeys.forEach(sk => grid[sk] = {});
    Object.values(logs).forEach(log => {
      if (!log.symptoms || !log.date) return;
      const day = dayOfCycleForDate(new Date(log.date), state.lastPeriodStart, cycleLen);
      if (!day) return;
      log.symptoms.forEach(s => { if (grid[s]) { grid[s][day] = (grid[s][day]||0) + 1; } });
    });
    return grid;
  }, [logs, cycleLen]);
  const maxCount = Math.max(1, ...symptomKeys.flatMap(sk => Object.values(data[sk]||{})));
  return html`
    <${Card} style="margin-bottom:18px;" class="anim">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">Симптомы по дням цикла</div>
      <div style="overflow-x:auto;">
        <div style="display:grid;grid-template-columns:70px repeat(${cycleLen},1fr);gap:3px;min-width:${70+cycleLen*22}px;">
          <div></div>
          ${Array.from({length:cycleLen},(_,i)=>i+1).map(d=>html`<div key=${d} style="text-align:center;font-size:9px;color:var(--text2);font-weight:600;padding:4px 0;">${d}</div>`)}
          ${symptomKeys.map(sk=>html`
            <div key=${sk} style="display:contents;">
              <div style="font-size:10px;color:var(--text2);font-weight:600;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${symptomLabels[sk]}</div>
              ${Array.from({length:cycleLen},(_,i)=>i+1).map(d=>{
                const count = data[sk]?.[d] || 0;
                const intensity = count / maxCount;
                const color = intensity > 0 ? `rgba(239,68,68,${0.15 + intensity * 0.85})` : 'transparent';
                return html`<div key=${d} style="aspect-ratio:1;border-radius:4px;background:${color};border:1px solid ${intensity>0?'rgba(239,68,68,0.3)':'var(--border)'};" title="${count} раз" />`;
              })}
            </div>
          `)}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;justify-content:center;">
        <span style="font-size:10px;color:var(--text2);">Редко</span>
        <div style="display:flex;gap:2px;">${[0.2,0.4,0.6,0.8,1].map(a=>html`<div key=${a} style="width:16px;height:8px;border-radius:2px;background:rgba(239,68,68,${0.15+a*0.85});" />`)}</div>
        <span style="font-size:10px;color:var(--text2);">Часто</span>
      </div>
    <//>
  `;
}

function Calendar() {
  const [view, setView] = useState('calendar');
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [logs, setLogs] = useState(store.getState().logs);
  const [profile, setProfile] = useState(store.getState().profile);
  useEffect(() => store.sub(s => { setLogs(s.logs); setProfile(s.profile); }), []);
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const today = new Date();
  const lps = store.getState().lastPeriodStart;
  const cycleLength = profile?.averageCycleLength || 28;
  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const stats = useMemo(() => {
    const entries = Object.values(logs);
    if (!entries.length) return null;
    const avg = k => entries.reduce((s, l) => s + (l[k]||0), 0) / entries.length;
    return { energy: avg('energyLevel'), anxiety: avg('anxietyLevel'), sleep: avg('sleepQuality'), libido: avg('libidoLevel'), count: entries.length };
  }, [logs]);
  const seen = store.getState().coachMarksSeen;
  const [, forceUpdate] = useState(0);
  return html`
    <${Scrollable} style="padding:28px 20px 120px;">
      ${!seen.dayTap && html`<${CoachMark} id="dayTap" text="Нажмите на день, чтобы увидеть фазу" onDismiss=${()=>forceUpdate(x=>x+1)} />`}
      ${seen.dayTap && !seen.swipeMonth && html`<${CoachMark} id="swipeMonth" text="Листайте месяцы стрелками ‹ ›" onDismiss=${()=>forceUpdate(x=>x+1)} />`}
      ${seen.dayTap && seen.swipeMonth && !seen.markPeriod && html`<${CoachMark} id="markPeriod" text="Удерживайте день, чтобы отметить с него начало месячных" onDismiss=${()=>forceUpdate(x=>x+1)} />`}
      <h1 style="font-size:28px;font-weight:800;margin-bottom:6px;letter-spacing:-0.02em;" class="anim">Календарь</h1>
      <p style="font-size:13px;color:var(--text2);margin-bottom:24px;font-weight:500;" class="anim">Визуализация цикла и симптомов</p>
      <div style="display:flex;gap:6px;padding:5px;border-radius:18px;background:var(--surface);border:1px solid var(--border);margin-bottom:28px;" class="anim">
        <button onClick=${()=>setView('calendar')} style="flex:1;padding:10px 6px;border-radius:13px;border:none;background:${view==='calendar'?'var(--accent)':'transparent'};color:${view==='calendar'?'#fff':'var(--text2)'};font-size:13px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:${view==='calendar'?`0 4px 16px ${theme.accentGlow}`:'none'};">Месяц</button>
        <button onClick=${()=>setView('stats')} style="flex:1;padding:10px 6px;border-radius:13px;border:none;background:${view==='stats'?'var(--accent)':'transparent'};color:${view==='stats'?'#fff':'var(--text2)'};font-size:13px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:${view==='stats'?`0 4px 16px ${theme.accentGlow}`:'none'};">Статистика</button>
      </div>
      ${view==='calendar' && html`
        ${(() => {
          const todayDay = lps ? NE.dayOf(lps, cycleLength) : null;
          const daysUntilPeriod = todayDay !== null ? (cycleLength - todayDay + 1 > 0 ? cycleLength - todayDay + 1 : 0) : null;
          return html`
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;" class="anim">
              <${Card} style="padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--accent);">${todayDay ?? '–'}</div><div style="font-size:10px;color:var(--text2);margin-top:2px;font-weight:600;">день цикла</div><//>
              <${Card} style="padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--accent);">${daysUntilPeriod!==null ? (daysUntilPeriod<=0?'—':daysUntilPeriod) : '–'}</div><div style="font-size:10px;color:var(--text2);margin-top:2px;font-weight:600;">дней до месячных</div><//>
              <${Card} style="padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--accent);">${cycleLength}</div><div style="font-size:10px;color:var(--text2);margin-top:2px;font-weight:600;">длина цикла</div><//>
            </div>
            <div style="display:flex;height:6px;border-radius:999px;overflow:hidden;margin-bottom:24px;" class="anim">
              ${(() => {
                const segs = [];
                for (let d=1; d<=cycleLength; d++) segs.push(NE.dcat(d, cycleLength));
                const blocks = [];
                segs.forEach(cat => { const last = blocks[blocks.length-1]; if (last && last.cat===cat) last.n++; else blocks.push({cat, n:1}); });
                return blocks.map((b,i) => html`<div key=${i} style="flex:${b.n};background:${NE.dc(b.cat)};" />`);
              })()}
            </div>
          `;
        })()}
        <${Card} class="anim">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <button onClick=${prevMonth} style="background:var(--surface);border:none;border-radius:12px;width:36px;height:36px;color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.9)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}>‹</button>
            <div style="font-size:17px;font-weight:700;color:var(--text);">${months[month]} ${year}</div>
            <button onClick=${nextMonth} style="background:var(--surface);border:none;border-radius:12px;width:36px;height:36px;color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.9)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}>›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;">
            ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => html`<div key=${d} style="text-align:center;font-size:11px;color:var(--text2);padding:8px 0;font-weight:700;">${d}</div>`)}
            ${days.map((d, i) => {
              if (!d) return html`<div key=${i} />`;
              const dateObj = new Date(year, month, d);
              const iso = localISO(dateObj);
              const log = logs[iso];
              const dayNum = dayOfCycleForDate(dateObj, lps, cycleLength);
              const cat = dayNum ? NE.dcat(dayNum, cycleLength) : null;
              const fert = dayNum ? NE.fertility(dayNum, cycleLength) : null;
              const fertLevel = {low:1,medium:2,high:3}[fert] || 0;
              const color = cat ? NE.dc(cat) : 'var(--text2)';
              const isToday = isSameDay(dateObj, today);
              const isFuture = dateObj > today;
              const hasSymptoms = log?.symptoms?.length > 0;
              const markPeriodFrom = () => {
                haptic('medium');
                const doMark = () => { store.addLog({ ...(logs[iso] || { date: iso, energyLevel:3, focusLevel:3, anxietyLevel:2, sleepQuality:3 }), date: iso, isPeriod: true }); notify('success'); };
                if (tg?.showConfirm) tg.showConfirm(`Отметить начало месячных с ${d} ${months[month].toLowerCase()}?`, ok => { if (ok) doMark(); });
                else if (confirm(`Отметить начало месячных с ${d} ${months[month].toLowerCase()}?`)) doMark();
              };
              let pressTimer = null; let longPressFired = false;
              const onPressStart = e => { e.currentTarget.style.transform='scale(0.92)'; pressTimer = setTimeout(()=>{longPressFired=true;markPeriodFrom();}, 500); };
              const onPressEnd = e => { e.currentTarget.style.transform='scale(1)'; if (pressTimer) clearTimeout(pressTimer); };
              return html`
                <button key=${i} onClick=${()=>{ if (longPressFired) { longPressFired=false; return; } haptic('medium'); setSelectedDate(iso); }}
                  style="aspect-ratio:1/1;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;transition:all 0.2s;border:2px solid ${isToday?(color+'60'):'transparent'};background:${color}10;opacity:${isFuture?0.5:1};color:var(--text);cursor:pointer;padding:0;"
                  onTouchStart=${onPressStart} onTouchEnd=${onPressEnd} onMouseDown=${onPressStart} onMouseUp=${onPressEnd} onMouseLeave=${onPressEnd}
                >
                  <span style="font-size:13px;font-weight:800;color:${color};">${d}</span>
                  ${dayNum && html`<span style="font-size:8px;color:var(--text2);margin-top:2px;opacity:0.7;font-weight:500;">${dayNum}д</span>`}
                  ${hasSymptoms && html`<div style="width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 4px ${theme.accentGlow};margin-top:3px;" />`}
                  ${fertLevel > 0 && html`<div style="position:absolute;bottom:4px;left:0;right:0;display:flex;justify-content:center;gap:2px;">${[1,2,3].map(n => html`<div key=${n} style="width:6px;height:3px;border-radius:1px;background:${n<=fertLevel?'#10B981':'var(--border)'};" />`)}</div>`}
                </button>
              `;
            })}
          </div>
          <div style="display:flex;justify-content:center;gap:16px;margin-top:24px;flex-wrap:wrap;">
            ${[['menstruation','Менструация'],['follicular','Фолликулярная'],['fertile','Фертильное окно'],['ovulation','Овуляция'],['luteal','Лютеиновая'],['pms','ПМС']].map(p => html`<div key=${p[0]} style="display:flex;align-items:center;gap:6px;"><div style="width:10px;height:10px;border-radius:50%;background:${NE.dc(p[0])};box-shadow:0 0 8px ${NE.dc(p[0])}50;" /><span style="font-size:11px;color:var(--text2);font-weight:500;">${p[1]}</span></div>`)}
          </div>
          <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;"><div style="display:flex;gap:2px;">${[1,2,3].map(n => html`<div key=${n} style="width:6px;height:3px;border-radius:1px;background:#10B981;" />`)}</div><span style="font-size:10px;color:var(--text2);font-weight:500;">Шанс зачатия (заполненность = выше)</span></div>
          </div>
          <div style="display:flex;justify-content:center;gap:16px;margin-top:14px;flex-wrap:wrap;opacity:0.7;">
            <div style="display:flex;align-items:center;gap:6px;"><div style="width:5px;height:5px;border-radius:50%;background:var(--accent);" /><span style="font-size:10px;color:var(--text2);">Есть симптомы в этот день</span></div>
          </div>
        <//>
      `}
      ${view==='stats' && (!stats ? html`
        <${Card} style="text-align:center;padding:48px 24px;" class="anim"><div style="font-size:44px;margin-bottom:16px;">📊</div><p style="font-size:16px;color:var(--text2);line-height:1.6;font-weight:500;">Пока недостаточно данных.<br/>Заполни несколько чек-инов.</p><//>
      ` : html`
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="text-align:center;font-size:12px;color:var(--text2);margin-bottom:4px;font-weight:500;" class="anim">На основе ${stats.count} ${stats.count===1?'записи':'записей'}</div>
          <${CycleChart} />
          <${SymptomHeatmap} />
          ${[{l:'Энергия',v:stats.energy,c:'#10B981'},{l:'Тревожность',v:stats.anxiety,c:'#EF4444'},{l:'Сон',v:stats.sleep,c:'#6366F1'},{l:'Либидо',v:stats.libido,c:'#EC4899'}].map((m,i) => html`
            <${Card} key=${m.l} style="padding:20px;" class="anim">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-size:15px;font-weight:700;color:var(--text);">${m.l}</span><span style="font-size:15px;font-weight:800;color:${m.c};font-variant-numeric:tabular-nums;">${m.v.toFixed(1)} / 5</span></div>
              <div style="height:16px;border-radius:999px;overflow:hidden;background:var(--bg);"><div style="height:100%;border-radius:999px;background:${m.c};width:${(m.v/5)*100}%;box-shadow:0 0 14px ${m.c}35;transition:width 1s ${i*0.1}s cubic-bezier(0.16,1,0.3,1);" /></div>
            <//>
          `)}
        </div>
      `)}
      ${view==='stats' && html`<div style="margin-top:24px;text-align:center;font-size:11px;color:var(--text2);opacity:0.6;">Сброс данных и экспорт — во вкладке «Настройки»</div>`}
      ${selectedDate && html`<${DayDetailModal} date=${selectedDate} dayData=${logs[selectedDate]} onClose=${()=>setSelectedDate(null)} />`}
    <//>
  `;
}

const defaultLog = {
  date: todayStr(), isPeriod: false, energyLevel: 3, focusLevel: 3, anxietyLevel: 2,
  mood: 'calm', libidoLevel: 2, intimacy: { occurred: false, type: 'none', protection: null, orgasm: false, discomfort: false },
  sleepQuality: 3, symptoms: [], cervicalMucus: 'dry',
};

function CheckIn({ onClose }) {
  const [step, setStep] = useState('brain');
  const [direction, setDirection] = useState('next');
  const savedLog = store.getState().logs[todayStr()];
  const draft = store.getState().draftLog;
  const getInitialLog = () => {
    if (savedLog && savedLog.date === todayStr()) return JSON.parse(JSON.stringify({ ...defaultLog, ...savedLog }));
    if (draft && draft.date === todayStr()) return JSON.parse(JSON.stringify({ ...defaultLog, ...draft }));
    return JSON.parse(JSON.stringify({ ...defaultLog }));
  };
  const [log, setLog] = useState(getInitialLog);
  useEffect(() => { store.setDraft(log); }, [log]);
  const steps = [{k:'brain',l:'Мозг'},{k:'intimacy',l:'Интим'},{k:'body',l:'Тело'}];
  const si = steps.findIndex(s => s.k === step);
  const next = () => {
    haptic();
    setDirection('next');
    if (step === 'brain') setStep('intimacy');
    else if (step === 'intimacy') setStep('body');
    else { store.addLog({ ...defaultLog, ...log }); store.clearDraft(); notify('success'); onClose(); }
  };
  const back = () => {
    haptic();
    setDirection('back');
    if (step === 'brain') { store.clearDraft(); onClose(); }
    else if (step === 'intimacy') setStep('brain');
    else setStep('intimacy');
  };
  useTgBackButton(true, back);
  useTgMainButton(step==='body'?'Сохранить':'Далее', true, next, theme.accent, '#ffffff');
  const upd = p => setLog(prev => ({ ...prev, ...p }));
  const moods = [{k:'euphoric',l:'Эйфория',e:'🤩'},{k:'calm',l:'Спокойствие',e:'😌'},{k:'irritated',l:'Раздражение',e:'😤'},{k:'sad',l:'Грусть',e:'😢'},{k:'anxious',l:'Тревога',e:'😰'},{k:'numb',l:'Апатия',e:'😶'}];
  const slider = (label, key, max=5) => {
    const pct = (log[key] / max) * 100;
    return html`
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:22px;">
        <div style="display:flex;justify-content:space-between;font-size:14px;"><span style="color:var(--text2);font-weight:500;">${label}</span><span style="font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;font-size:15px;">${log[key]}/${max}</span></div>
        <div style="position:relative;height:6px;border-radius:999px;background:var(--surface-hover);overflow:visible;">
          <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;border-radius:999px;background:linear-gradient(90deg,var(--accent),#0ea5e9);box-shadow:0 0 10px ${theme.accentGlow};transition:width 0.3s ease;" />
          <input type="range" min="0" max=${max} step="1" value=${log[key]} onInput=${e=>{haptic();upd({[key]:+e.target.value});}} style="position:absolute;inset:0;width:100%;height:200%;top:-50%;opacity:0;cursor:pointer;" />
          <div style="position:absolute;top:50%;left:${pct}%;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:var(--accent);box-shadow:0 0 16px ${theme.accentGlow};border:3px solid var(--bg2);pointer-events:none;transition:left 0.3s ease;" />
        </div>
      </div>
    `;
  };
  const symptoms = [{k:'cramps',l:'Спазмы',i:'⚡'},{k:'bloating',l:'Вздутие',i:'🎈'},{k:'headache',l:'Головная боль',i:'🤕'},{k:'breast_tenderness',l:'Чувств. груди',i:'💗'},{k:'acne',l:'Высыпания',i:'🔴'},{k:'fatigue',l:'Усталость',i:'😴'},{k:'insomnia',l:'Бессонница',i:'🌃'},{k:'cravings',l:'Тяга к сладкому',i:'🍫'}];
  const mucus = [{k:'dry',l:'Сухо',d:'Нет выделений'},{k:'sticky',l:'Липкие',d:'Густые, белые'},{k:'creamy',l:'Кремовые',d:'Молочные, влажные'},{k:'egg_white',l:'Яичный белок',d:'Прозрачные, тянущиеся'}];
  const toggleSym = key => { haptic(); const cur = log.symptoms || []; upd({ symptoms: cur.includes(key) ? cur.filter(s => s !== key) : [...cur, key] }); };
  const animClass = direction === 'next' ? 'slide-right' : 'slide-left';
  return html`
    <div style="position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:var(--bg);color:var(--text);animation:fadeIn 0.25s ease;">
      <${Scrollable}>
        ${step==='brain' && html`
          <div style="padding:20px 16px 40px;" class=${animClass}>
            <h3 style="font-size:22px;font-weight:800;text-align:center;margin-bottom:32px;color:var(--text);letter-spacing:-0.02em;">Мозг и энергия</h3>
            ${slider('Энергия','energyLevel')}${slider('Фокус','focusLevel')}${slider('Тревожность (кортизол)','anxietyLevel')}${slider('Качество сна','sleepQuality')}
            <div style="margin-top:12px;"><span style="font-size:14px;color:var(--text2);display:block;margin-bottom:14px;font-weight:600;">Настроение</span>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                ${moods.map(m=>html`<button key=${m.k} onClick=${()=>{haptic('medium');upd({mood:m.k});}} style="padding:16px 8px;border-radius:18px;border:2px solid ${log.mood===m.k?'var(--accent)':'var(--border)'};background:${log.mood===m.k?'var(--accent-soft)':'var(--surface)'};color:var(--text);font-size:12px;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:8px;transform:${log.mood===m.k?'scale(1.02)':'scale(1)'};box-shadow:${log.mood===m.k?`0 4px 16px ${theme.accentGlow}`:'none'};" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.95)'} onTouchEnd=${e=>e.currentTarget.style.transform=log.mood===m.k?'scale(1.02)':'scale(1)'}"><span style="font-size:32px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.1));">${m.e}</span><span style="font-weight:600;">${m.l}</span></button>`)}
              </div>
            </div>
          </div>
        `}
        ${step==='intimacy' && html`
          <div style="padding:20px 16px 40px;" class=${animClass}>
            <h3 style="font-size:22px;font-weight:800;text-align:center;margin-bottom:32px;color:var(--text);letter-spacing:-0.02em;">Интимность и тело</h3>
            <div style="margin-bottom:32px;"><div style="font-size:14px;color:var(--text2);text-align:center;margin-bottom:18px;font-weight:600;">Уровень либидо</div>
              <div style="display:flex;justify-content:space-between;align-items:flex-end;height:110px;gap:8px;">
                ${[0,1,2,3,4].map(lvl=>html`<button key=${lvl} onClick=${()=>{haptic('medium');upd({libidoLevel:lvl});}} style="flex:1;border-radius:16px;border:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:12px;height:${32+lvl*19}%;background:${log.libidoLevel>=lvl?`${theme.love}18`:'var(--surface)'};border:2px solid ${log.libidoLevel>=lvl?`${theme.love}50`:'var(--border)'};cursor:pointer;transition:all 0.25s;" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.96)'} onTouchEnd=${e=>e.currentTarget.style.transform='scale(1)'}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="color:${log.libidoLevel>=lvl?theme.love:'var(--text2)'};transition:all 0.2s;"><path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" stroke="currentColor" stroke-width="1.5" fill=${log.libidoLevel>=lvl?'currentColor':'none'} /></svg></button>`)}
              </div>
              <div style="text-align:center;font-size:14px;color:var(--text2);margin-top:12px;font-weight:700;">${['Спит','Тихо','Возможно','Желание','На пределе'][log.libidoLevel]}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;"><span style="font-size:14px;color:var(--text2);font-weight:600;">Была интимность?</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${[{k:'none',l:'Нет',i:'🌙'},{k:'solo',l:'Соло',i:'✨'},{k:'partner',l:'С партнёром',i:'🔮'}].map(opt=>{
                  const isSelected = (opt.k==='none'&&!log.intimacy.occurred)||(opt.k!=='none'&&log.intimacy.occurred&&log.intimacy.type===opt.k);
                  return html`<button key=${opt.k} onClick=${()=>{haptic('medium');upd({intimacy:{...log.intimacy,occurred:opt.k!=='none',type:opt.k}});}} style="padding:18px;border-radius:18px;border:2px solid ${isSelected?`${theme.love}55`:'var(--border)'};background:${isSelected?`${theme.love}10`:'var(--surface)'};color:var(--text);font-size:14px;font-weight:700;text-align:center;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:8px;transform:${isSelected?'scale(1.02)':'scale(1)'};box-shadow:${isSelected?`0 4px 16px ${theme.love}25`:'none'};" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.95)'} onTouchEnd=${e=>e.currentTarget.style.transform=isSelected?'scale(1.02)':'scale(1)'}"><span style="font-size:28px;">${opt.i}</span><span>${opt.l}</span></button>`;
                })}
              </div>
            </div>
            ${log.intimacy.occurred && html`
              <div style="display:flex;flex-direction:column;gap:16px;animation:fadeIn 0.3s ease;">
                <button onClick=${()=>{upd({intimacy:{...log.intimacy,orgasm:!log.intimacy.orgasm}});if(!log.intimacy.orgasm){notify('success');tg?.showAlert?.('Окситоциновый буст! Уровень кортизола снижен.');}}} style="padding:14px;border-radius:16px;border:2px solid ${log.intimacy.orgasm?'rgba(245,158,11,0.5)':'var(--border)'};background:${log.intimacy.orgasm?'rgba(245,158,11,0.08)':'var(--surface)'};color:var(--text);font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;text-align:center;">${log.intimacy.orgasm?'✨ Оргазм отмечен':'Отметить оргазм'}</button>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${[{k:'protected',l:'С защитой'},{k:'unprotected',l:'Без защиты'}].map(p=>html`<button key=${p.k} onClick=${()=>upd({intimacy:{...log.intimacy,protection:p.k}})} style="padding:14px;border-radius:16px;border:2px solid ${log.intimacy.protection===p.k?'rgba(139,92,246,0.5)':'var(--border)'};background:${log.intimacy.protection===p.k?'rgba(139,92,246,0.08)':'var(--surface)'};color:var(--text);font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">${p.l}</button>`)}</div>
                <button onClick=${()=>upd({intimacy:{...log.intimacy,discomfort:!log.intimacy.discomfort}})} style="padding:14px;border-radius:16px;border:2px solid ${log.intimacy.discomfort?'rgba(249,115,22,0.5)':'var(--border)'};background:${log.intimacy.discomfort?'rgba(249,115,22,0.08)':'var(--surface)'};color:var(--text);font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;text-align:center;">${log.intimacy.discomfort?'⚠ Дискомфорт отмечен':'Отметить дискомфорт'}</button>
              </div>
            `}
          </div>
        `}
        ${step==='body' && html`
          <div style="padding:20px 16px 40px;" class=${animClass}>
            <h3 style="font-size:22px;font-weight:800;text-align:center;margin-bottom:32px;color:var(--text);letter-spacing:-0.02em;">Тело и симптомы</h3>
            <div style="display:flex;justify-content:space-between;align-items:center;border-radius:16px;padding:18px;background:var(--surface);border:1px solid var(--border);margin-bottom:24px;">
              <div><div style="font-size:15px;font-weight:700;">Менструация сегодня</div><div style="font-size:12px;color:var(--text2);margin-top:4px;font-weight:500;">Отметь, если идут кровотечения</div></div>
              <button onClick=${()=>{haptic('medium');upd({isPeriod:!log.isPeriod});}} style="width:52px;height:30px;border-radius:999px;border:none;position:relative;background:${log.isPeriod?'#EF4444':'var(--surface-hover)'};cursor:pointer;transition:background 0.3s;"><div style="position:absolute;width:26px;height:26px;border-radius:50%;background:white;top:2px;transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);transform:translateX(${log.isPeriod?22:4}px);box-shadow:0 2px 8px rgba(0,0,0,0.2);" /></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;"><span style="font-size:14px;color:var(--text2);font-weight:600;">Шейная слизь</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${mucus.map(m=>html`<button key=${m.k} onClick=${()=>{haptic();upd({cervicalMucus:m.k});}} style="padding:14px;border-radius:16px;border:2px solid ${log.cervicalMucus===m.k?'rgba(59,130,246,0.5)':'var(--border)'};background:${log.cervicalMucus===m.k?'rgba(59,130,246,0.08)':'var(--surface)'};color:var(--text);font-size:14px;cursor:pointer;transition:all 0.2s;text-align:left;"><div style="font-weight:700;margin-bottom:3px;">${m.l}</div><div style="font-size:12px;color:var(--text2);font-weight:500;">${m.d}</div></button>`)}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;"><span style="font-size:14px;color:var(--text2);font-weight:600;">Симптомы</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${symptoms.map(s=>html`<button key=${s.k} onClick=${()=>toggleSym(s.k)} style="padding:14px;border-radius:16px;border:2px solid ${log.symptoms?.includes(s.k)?'var(--accent)':'var(--border)'};background:${log.symptoms?.includes(s.k)?'var(--accent-soft)':'var(--surface)'};color:var(--text);font-size:13px;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:6px;transform:${log.symptoms?.includes(s.k)?'scale(1.02)':'scale(1)'};box-shadow:${log.symptoms?.includes(s.k)?`0 4px 14px ${theme.accentGlow}`:'none'};" onTouchStart=${e=>e.currentTarget.style.transform='scale(0.95)'} onTouchEnd=${e=>e.currentTarget.style.transform=log.symptoms?.includes(s.k)?'scale(1.02)':'scale(1)'}"><span style="font-size:24px;">${s.i}</span><span style="font-weight:600;">${s.l}</span></button>`)}
              </div>
            </div>
          </div>
        `}
      <//>
    </div>
  `;
}

function Settings() {
  const [profile, setP] = useState(store.getState().profile);
  const [palette, setPal] = useState(store.getState().palette);
  const [paletteName, setPalName] = useState(store.getState().paletteName);
  const [notif, setNotif] = useState(store.getState().notifSettings);
  useEffect(() => store.sub(s => { setP(s.profile); setPal(s.palette); setPalName(s.paletteName); setNotif(s.notifSettings); }), []);
  if (!profile) return html`<div style="padding:40px 20px;color:var(--text2);text-align:center;">Загрузка...</div>`;
  const saveProfile = patch => { store.setProfile({ ...profile, ...patch }); haptic('light'); };
  const cats = [['menstruation','Менструация'],['follicular','Фолликулярная'],['fertile','Фертильное окно'],['ovulation','Овуляция'],['luteal','Лютеиновая'],['pms','ПМС']];
  const swatchOptions = ['#EF4444','#EC4899','#FBBF24','#38BDF8','#6366F1','#A8A29E','#F97316','#22D3EE','#A78BFA','#10B981','#F43F5E','#94A3B8'];

  const downloadCSV = () => {
    const csv = store.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'neuroflow_export.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); haptic('medium');
  };

  const downloadPDF = () => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFontSize(18); doc.text('NeuroFlow — Отчёт', 14, 22);
      doc.setFontSize(11); doc.setTextColor(100);
      doc.text(`Дата: ${new Date().toLocaleDateString('ru-RU')}`, 14, 30);
      doc.text(`Средний цикл: ${profile.averageCycleLength} дней | Менструация: ${profile.averagePeriodLength} дней`, 14, 36);
      doc.setFontSize(12); doc.setTextColor(0); doc.text('Записи:', 14, 46);
      let y = 54;
      const entries = Object.values(store.getState().logs).sort((a,b)=>a.date<b.date?-1:1);
      entries.forEach(l => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.text(`${l.date} | Энергия:${l.energyLevel} Фокус:${l.focusLevel} Тревога:${l.anxietyLevel} Сон:${l.sleepQuality} ${l.isPeriod?'[Менструация]':''}`, 14, y);
        y += 6;
      });
      doc.save('neuroflow_report.pdf');
      haptic('medium');
    } catch(e) { alert('PDF недоступен. Проверьте подключение к сети.'); }
  };

  return html`
    <${Scrollable} style="padding:28px 20px 120px;">
      <h1 style="font-size:28px;font-weight:800;margin-bottom:24px;letter-spacing:-0.02em;" class="anim">Настройки</h1>
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Цикл</div>
      <${Card} style="margin-bottom:18px;" class="anim">
        <div style="font-size:14px;color:var(--text2);font-weight:500;margin-bottom:14px;">Длина цикла</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:24px;margin-bottom:20px;">
          <button onClick=${()=>saveProfile({averageCycleLength:Math.max(21,profile.averageCycleLength-1)})} style="width:44px;height:44px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:20px;font-weight:700;cursor:pointer;">−</button>
          <span style="font-size:26px;font-weight:800;color:var(--accent);min-width:56px;text-align:center;font-variant-numeric:tabular-nums;">${profile.averageCycleLength}</span>
          <button onClick=${()=>saveProfile({averageCycleLength:Math.min(38,profile.averageCycleLength+1)})} style="width:44px;height:44px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:20px;font-weight:700;cursor:pointer;">+</button>
        </div>
        <div style="font-size:14px;color:var(--text2);font-weight:500;margin-bottom:12px;">Длительность менструации</div>
        <div style="display:flex;gap:6px;">
          ${[3,4,5,6,7,8].map(n=>html`<button key=${n} onClick=${()=>saveProfile({averagePeriodLength:n})} style="flex:1;height:40px;border-radius:10px;border:1.5px solid ${profile.averagePeriodLength===n?'var(--accent)':'var(--border)'};background:${profile.averagePeriodLength===n?'var(--accent)':'var(--surface-hover)'};color:${profile.averagePeriodLength===n?'#fff':'var(--text)'};font-size:14px;font-weight:700;cursor:pointer;">${n}</button>`)}
        </div>
      <//>
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Уведомления</div>
      <${Card} style="margin-bottom:18px;" class="anim">
        <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:16px;padding:10px 12px;background:${theme.accentGlow};border-radius:12px;">
          Пуши требуют серверной части бота. Настройки сохраняются локально, реальные уведомления работают после подключения бэкенда.
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span style="font-size:14px;color:var(--text);font-weight:500;">За сколько дней напомнить о месячных</span></div>
        <div style="display:flex;gap:6px;margin-bottom:20px;">
          ${[1,2,3,5,7].map(n=>html`<button key=${n} onClick=${()=>store.setNotifSettings({periodReminder:n})} style="flex:1;height:38px;border-radius:10px;border:1.5px solid ${notif.periodReminder===n?'var(--accent)':'var(--border)'};background:${notif.periodReminder===n?'var(--accent)':'var(--surface-hover)'};color:${notif.periodReminder===n?'#fff':'var(--text)'};font-size:13px;font-weight:700;cursor:pointer;">${n}</button>`)}
        </div>
        ${[['ovulationAlert','Уведомлять в день овуляции'],['pmsAlert','Уведомлять в начале ПМС']].map(([k,label])=>html`
          <div key=${k} style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
            <span style="font-size:14px;color:var(--text);font-weight:500;">${label}</span>
            <button onClick=${()=>store.setNotifSettings({[k]:!notif[k]})} style="width:48px;height:28px;border-radius:999px;border:none;background:${notif[k]?theme.accent:'var(--surface-hover)'};position:relative;cursor:pointer;"><div style="position:absolute;width:22px;height:22px;border-radius:50%;background:white;top:3px;transition:transform 0.2s;transform:translateX(${notif[k]?22:3}px);" /></div>
          </div>
        `)}
      <//>
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Цвета фаз</div>
      <${Card} style="margin-bottom:18px;" class="anim">
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;margin-bottom:16px;">
          ${Object.entries(PRESETS).map(([id,p])=>html`
            <button key=${id} onClick=${()=>{store.setPalette(p, id);haptic('medium');}} style="flex-shrink:0;padding:10px 14px;border-radius:14px;border:1.5px solid ${paletteName===id?'var(--accent)':'var(--border)'};background:var(--surface-hover);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <div style="display:flex;gap:3px;">${cats.map(([c])=>html`<div key=${c} style="width:8px;height:8px;border-radius:50%;background:${p[c]};" />`)}</div>
              <span style="font-size:11px;color:var(--text);font-weight:600;">${p.name}</span>
            </button>
          `)}
        </div>
        ${cats.map(([cat,label])=>html`
          <div key=${cat} style="margin-bottom:14px;">
            <div style="font-size:13px;color:var(--text2);font-weight:500;margin-bottom:8px;">${label}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${swatchOptions.map(color=>html`<button key=${color} onClick=${()=>{store.setPalette({...palette,[cat]:color},'custom');haptic('light');}} style="width:28px;height:28px;border-radius:9px;background:${color};border:2px solid ${palette[cat]===color?'var(--text)':'transparent'};cursor:pointer;" />`)}
            </div>
          </div>
        `)}
        <button onClick=${()=>{store.resetPalette();haptic();}} style="width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--border);background:none;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;">Сбросить к стандартной палитре</button>
      <//>
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Данные</div>
      <${Card} style="margin-bottom:18px;" class="anim">
        <button onClick=${downloadCSV} style="width:100%;padding:14px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;">📄 Экспорт в CSV</button>
        <button onClick=${downloadPDF} style="width:100%;padding:14px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface-hover);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;">📑 Экспорт в PDF</button>
        <button onClick=${()=>{const doReset=()=>store.resetAll();if(tg?.showConfirm)tg.showConfirm('Удалить все данные приложения? Это нельзя отменить.',ok=>{if(ok)doReset();});else if(confirm('Удалить все данные приложения? Это нельзя отменить.'))doReset();}} style="width:100%;padding:14px;border-radius:12px;border:1.5px solid ${theme.danger}40;background:none;color:${theme.danger};font-size:14px;font-weight:600;cursor:pointer;">Удалить все данные</button>
      <//>
      <div style="text-align:center;font-size:10px;color:var(--text2);opacity:0.5;margin-top:8px;">build 2026.08.16-final</div>
    <//>
  `;
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [lps, setLps] = useState(store.getState().lastPeriodStart);
  const [showTutorial, setShowTutorial] = useState(!store.getState().tutorialSeen);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadState().then(() => {
      setLoaded(true);
      setLps(store.getState().lastPeriodStart);
      setShowTutorial(!store.getState().tutorialSeen);
      const uid = tg?.initDataUnsafe?.user?.id;
      initStore(uid ? uid.toString() : 'guest');
    });
    const unsub = store.sub(s => { setLps(s.lastPeriodStart); setShowTutorial(!s.tutorialSeen); });
    if (tg?.SettingsButton) { tg.SettingsButton.show(); tg.SettingsButton.onClick(() => setTab('settings')); }
    return () => {
      unsub();
      if (tg?.SettingsButton) { tg.SettingsButton.hide(); tg.SettingsButton.offClick(() => setTab('settings')); }
    };
  }, []);

  const changeTab = t => { haptic(); setTab(t); };

  if (!loaded) return html`<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--text2);font-size:15px;">Загрузка...</div>`;
  if (showTutorial) return html`<${Tutorial} onComplete=${() => setShowTutorial(false)} />`;
  if (!lps) return html`<${Onboarding} />`;

  return html`
    <div style="background:var(--bg);color:var(--text);min-height:100vh;position:relative;">
      ${tab==='dashboard' && html`<${Dashboard} onCheckIn=${()=>setCheckInOpen(true)} />`}
      ${tab==='planner' && html`<${Planner} />`}
      ${tab==='calendar' && html`<${Calendar} />`}
      ${tab==='settings' && html`<${Settings} />`}
      ${checkInOpen && html`<${CheckIn} onClose=${()=>setCheckInOpen(false)} />`}
      ${!checkInOpen && html`
      <nav style="position:fixed;bottom:0;left:0;right:0;background:rgba(15,20,25,0.85);backdrop-filter:blur(20px);border-top:1px solid var(--border);z-index:50;display:flex;justify-content:space-around;padding:8px 0;padding-bottom:calc(8px + env(safe-area-inset-bottom));">
        ${[{k:'dashboard',l:'Главная',i:'◉'},{k:'planner',l:'Планер',i:'☰'},{k:'calendar',l:'Календарь',i:'◎'},{k:'settings',l:'Настройки',i:'⚙'}].map(t=>html`
          <button key=${t.k} onClick=${()=>changeTab(t.k)} style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 28px;border-radius:12px;border:none;background:${tab===t.k?'var(--surface)':'none'};color:${tab===t.k?'var(--accent)':'var(--text2)'};font-weight:${tab===t.k?700:500};font-size:10px;cursor:pointer;transition:all 0.2s;">
            <span style="font-size:20px;transition:transform 0.2s;transform:${tab===t.k?'scale(1.15)':'scale(1)'}">${t.i}</span>${t.l}
          </button>
        `)}
      </nav>
      `}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
