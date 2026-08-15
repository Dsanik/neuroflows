import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { html } from 'htm/preact';

// ===== TELEGRAM =====
const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    const r = document.documentElement.style;
    const p = tg.themeParams || {};
    r.setProperty('--tg-bg', p.bg_color || '#ffffff');
    r.setProperty('--tg-text', p.text_color || '#000000');
    r.setProperty('--tg-hint', p.hint_color || '#999999');
    r.setProperty('--tg-button', p.button_color || '#000000');
    r.setProperty('--tg-button-text', p.button_text_color || '#ffffff');
    r.setProperty('--tg-secondary-bg', p.secondary_bg_color || '#f5f5f5');
  } catch(e) { console.error('TG theme error', e); }
}

// ===== STORE =====
const KEY = 'nf_v1';
let subs = [];
let state = { profile: null, logs: {}, lastPeriodStart: null, currentProfile: null, draftLog: null };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };
} catch(e) {}
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const pub = () => subs.forEach(cb => cb(state));
const store = {
  getState: () => state,
  sub: cb => { subs.push(cb); return () => { subs = subs.filter(c => c !== cb); }; },
  setProfile: p => { state.profile = p; save(); pub(); },
  setLps: d => { state.lastPeriodStart = d; save(); compute(); pub(); },
  addLog: log => { state.logs[log.date] = log; save(); pub(); },
  setDraft: log => { state.draftLog = log; save(); pub(); },
  clearDraft: () => { state.draftLog = null; save(); pub(); },
};

// ===== ENGINE =====
const NE = {
  getEstrogen(d, L=28) { const ov=L-14; return d<=ov ? Math.exp(-Math.pow(d-ov,2)/10) : 0.3+0.4*Math.exp(-Math.pow(d-(ov+7),2)/15); },
  getProgesterone(d, L=28) { const ov=L-14; return d<=ov ? 0.05 : Math.max(0, Math.sin((Math.PI*(d-ov))/14)); },
  getTestosterone(d, L=28) { const ov=L-14; return Math.exp(-Math.pow(d-ov,2)/4); },
  cns(e, p, s=4) { let b=e*0.6-p*0.3+0.5; return Math.min(100, Math.max(0, b*50+s*10)); },
  phase(d, L=28) { if(d<=5)return'menstruation'; if(d<=13)return'follicular'; if(d<=16)return'ovulation'; return'luteal'; },
  dayOf(lps, L=28) { const st=new Date(lps).getTime(); const now=Date.now(); const diff=Math.floor((now-st)/(86400000)); const day=(diff%L)+1; return day>0?day:1; },
  prof(day, L=28, sleep=4) { const e=this.getEstrogen(day,L); const p=this.getProgesterone(day,L); const t=this.getTestosterone(day,L); return {estrogen:e, progesterone:p, testosterone:t, cnsCapacity:this.cns(e,p,sleep), phase:this.phase(day,L), dayOfCycle:day}; },
  pc(ph) { return {menstruation:'#10B981',follicular:'#F59E0B',ovulation:'#EF4444',luteal:'#6366F1'}[ph]; },
  pn(ph) { return {menstruation:'Менструация',follicular:'Фолликулярная',ovulation:'Овуляция',luteal:'Лютеиновая'}[ph]; },
  insight(ph, day) { const map={menstruation:'Прогестерон и эстроген на минимуме. Энергия низкая, ЦНС восстанавливается.',follicular:'Эстроген растёт. Идеальное время для новых проектов и обучения.',ovulation:`День ${day}: тестостерон и эстроген на пике. Уверенность максимальна.`,luteal:'Прогестерон доминирует. Глубокий фокус, но следи за тревожностью.'}; return map[ph]; },
  work(ph) { return {menstruation:'Рутинные задачи, планирование',follicular:'Новые проекты, обучение, переговоры',ovulation:'Публичные выступления, продажи, нетворкинг',luteal:'Глубокий анализ, завершение задач'}[ph]; },
  sport(ph) { return {menstruation:'Пилатес, йога, растяжка',follicular:'Кроссфит, бег, силовые',ovulation:'HIIT, танцы, командный спорт',luteal:'Йога, плавание, низкая интенсивность'}[ph]; },
  food(ph) { return {menstruation:'Железо, витамин C, тёплая еда',follicular:'Белок, зелень, пробиотики',ovulation:'Овощи, антиоксиданты, омега-3',luteal:'Сложные углеводы, магний, витамин B6'}[ph]; },
  intim(ph) { return {menstruation:'Реактивное либидо, нежность',follicular:'Спонтанное желание, эксперименты',ovulation:'Пик либидо, фертильность максимальна',luteal:'Мягкость, эмоциональная близость'}[ph]; },
};

function compute() {
  const { profile, lastPeriodStart } = state;
  if (!profile || !lastPeriodStart) return;
  const day = NE.dayOf(lastPeriodStart, profile.averageCycleLength);
  const y = new Date(); y.setDate(y.getDate()-1);
  const yk = y.toISOString().split('T')[0];
  const ylog = state.logs[yk];
  state.currentProfile = NE.prof(day, profile.averageCycleLength, ylog?.sleepQuality ?? 4);
  save();
}

function initStore(id) {
  if (!state.profile) {
    state.profile = { tgId: id, averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14, neuroSensitivity: 'medium', onContraception: false };
    save();
  }
  compute();
}

// ===== UI =====
const haptic = (t='light') => tg?.HapticFeedback?.impactOccurred?.(t);
const notify = (t='success') => tg?.HapticFeedback?.notificationOccurred?.(t);

function Onboarding() {
  const [date, setDate] = useState('');
  const [cycle, setCycle] = useState(28);
  const [period, setPeriod] = useState(5);
  const start = () => {
    if (!date) return;
    haptic('medium');
    const p = store.getState().profile;
    if (p) store.setProfile({ ...p, averageCycleLength: cycle, averagePeriodLength: period });
    store.setLps(date);
    notify('success');
  };
  return html`
    <div style="min-height:100vh;padding:24px 16px;display:flex;flex-direction:column;justify-content:center;gap:24px;background:var(--tg-bg);color:var(--tg-text)">
      <div style="text-align:center">
        <div style="font-size:48px">🧠</div>
        <h1 style="font-size:28px;font-weight:600;margin-top:8px">NeuroFlow</h1>
        <p style="font-size:14px;color:var(--tg-hint);margin-top:4px">Трекер цикла, который подстраивается под твою нейро-гормональную биологию</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div>
          <label style="font-size:14px;font-weight:500;display:block;margin-bottom:6px">Дата начала последней менструации</label>
          <input type="date" value=${date} onInput=${e=>setDate(e.target.value)}
            style="width:100%;padding:14px;border-radius:12px;border:2px solid ${date?'var(--tg-button)':'var(--tg-secondary-bg)'};background:var(--tg-secondary-bg);color:var(--tg-text);font-size:16px" />
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:14px"><span>Длина цикла</span><span style="color:var(--tg-hint)">${cycle} дней</span></div>
          <input type="range" min="21" max="35" value=${cycle} onInput=${e=>setCycle(+e.target.value)} style="width:100%;margin-top:6px" />
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:14px"><span>Длина периода</span><span style="color:var(--tg-hint)">${period} дней</span></div>
          <input type="range" min="2" max="8" value=${period} onInput=${e=>setPeriod(+e.target.value)} style="width:100%;margin-top:6px" />
        </div>
      </div>
      <button onClick=${start} disabled=${!date}
        style="width:100%;padding:14px;border-radius:12px;border:none;background:var(--tg-button);color:var(--tg-button-text);font-size:16px;font-weight:600;opacity:${date?1:0.4}">
        Начать
      </button>
    </div>
  `;
}

function Dashboard({ onCheckIn }) {
  const [profile, setP] = useState(store.getState().currentProfile);
  useEffect(() => store.sub(s => setP(s.currentProfile)), []);
  if (!profile) return html`<div style="padding:24px 16px;color:var(--tg-hint)">Загрузка...</div>`;
  const c = NE.pc(profile.phase);
  return html`
    <div style="padding:24px 16px 16px;display:flex;flex-direction:column;gap:16px;background:var(--tg-bg);color:var(--tg-text)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h1 style="font-size:24px;font-weight:500">NeuroFlow</h1>
          <p style="font-size:14px;color:var(--tg-hint)">Твой нейро-гормональный профиль</p>
        </div>
        <button onClick=${onCheckIn} style="padding:8px 16px;border-radius:12px;border:none;background:var(--tg-button);color:var(--tg-button-text);font-size:14px;font-weight:500">Чек-ин</button>
      </div>
      <div style="position:relative;width:224px;height:224px;margin:16px auto">
        <svg viewBox="0 0 200 200" style="width:100%;height:100%">
          <circle cx="100" cy="100" r="90" fill="none" stroke-width="12" style="stroke:var(--tg-secondary-bg)" />
          <circle cx="100" cy="100" r="90" fill="none" stroke=${c} stroke-width="12" stroke-linecap="round"
            stroke-dasharray=${2*Math.PI*90} stroke-dashoffset=${2*Math.PI*90 - (profile.dayOfCycle/28)*2*Math.PI*90} transform="rotate(-90 100 100)" />
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:36px;font-weight:500;color:${c};font-variant-numeric:tabular-nums">${profile.dayOfCycle}</div>
          <div style="font-size:12px;color:var(--tg-hint)">${NE.pn(profile.phase)}</div>
          <div style="font-size:10px;color:var(--tg-hint)">ЦНС: ${Math.round(profile.cnsCapacity)}%</div>
        </div>
      </div>
      <div style="border-radius:16px;padding:16px;background:var(--tg-secondary-bg);display:flex;flex-direction:column;gap:10px">
        <div style="font-size:14px;font-weight:500;color:var(--tg-hint)">Уровень гормонов</div>
        ${[{n:'Эстроген',v:profile.estrogen,c:'#EC4899'},{n:'Прогестерон',v:profile.progesterone,c:'#8B5CF6'},{n:'Тестостерон',v:profile.testosterone,c:'#F59E0B'}].map((h,i) => html`
          <div key=${i}>
            <div style="display:flex;justify-content:space-between;font-size:12px"><span>${h.n}</span><span style="color:${h.c};font-weight:500">${Math.round(h.v*100)}%</span></div>
            <div style="height:8px;border-radius:999px;overflow:hidden;background:var(--tg-bg);margin-top:4px">
              <div style="height:100%;border-radius:999px;background:${h.c};width:${h.v*100}%;transition:width 0.8s ${i*0.15}s" />
            </div>
          </div>
        `)}
      </div>
      <div style="border-radius:16px;padding:16px;background:${c}15;display:flex;align-items:center;gap:12px">
        <div style="font-size:28px">${profile.cnsCapacity>=80?'🚀':profile.cnsCapacity>=60?'⚡':profile.cnsCapacity>=40?'💡':profile.cnsCapacity>=20?'🌙':'🛌'}</div>
        <div>
          <div style="font-size:14px;font-weight:500;color:${c}">${profile.cnsCapacity>=80?'Пик производительности':profile.cnsCapacity>=60?'Высокий ресурс':profile.cnsCapacity>=40?'Средний ресурс':profile.cnsCapacity>=20?'Низкий ресурс':'Восстановление'}</div>
          <div style="font-size:12px;color:var(--tg-hint)">ЦНС загружен на ${Math.round(profile.cnsCapacity)}%</div>
        </div>
      </div>
      <div style="border-radius:16px;padding:16px;background:var(--tg-secondary-bg)">
        <div style="font-size:14px;font-weight:500;color:var(--tg-hint);margin-bottom:8px">Нейро-инсайт</div>
        <p style="font-size:14px;line-height:1.6">${NE.insight(profile.phase, profile.dayOfCycle)}</p>
      </div>
    </div>
  `;
}

function Planner() {
  const [tab, setTab] = useState('work');
  const [profile, setP] = useState(store.getState().currentProfile);
  useEffect(() => store.sub(s => setP(s.currentProfile)), []);
  if (!profile) return html`<div style="padding:24px 16px;color:var(--tg-hint)">Загрузка...</div>`;
  const ph = profile.phase;
  const c = NE.pc(ph);
  const tabs = [{k:'work',l:'Работа'},{k:'body',l:'Тело'},{k:'food',l:'Питание'}];
  return html`
    <div style="padding:24px 16px 16px;display:flex;flex-direction:column;gap:16px;background:var(--tg-bg);color:var(--tg-text)">
      <h1 style="font-size:24px;font-weight:500">Планер</h1>
      <p style="font-size:14px;color:var(--tg-hint)">Адаптация под текущую фазу</p>
      <div style="display:flex;gap:8px;padding:4px;border-radius:12px;background:var(--tg-secondary-bg)">
        ${tabs.map(t => html`
          <button key=${t.k} onClick=${()=>{haptic();setTab(t.k);}} style="flex:1;padding:8px;border-radius:8px;border:none;background:${tab===t.k?'var(--tg-bg)':'transparent'};color:${tab===t.k?'var(--tg-text)':'var(--tg-hint)'};font-size:14px;font-weight:500">
            ${t.l}
          </button>
        `)}
      </div>
      ${tab==='work' && html`
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="border-radius:16px;padding:16px;background:${c}15">
            <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:${c};margin-bottom:4px">Рекомендация фазы</div>
            <div style="font-size:14px">${NE.work(ph)}</div>
          </div>
          ${({menstruation:['Ответить на отложенные письма','Обновить to-do','Провести ретроспективу','Организовать пространство'],follicular:['Запустить новый проект','Мозговой штурм','Изучить инструмент','Начать обучение'],ovulation:['Важные переговоры','Выступить на публике','Закрыть сделку','Нетворкинг'],luteal:['Завершить задачи','Аудит процессов','Написать документацию','Подготовить отчёты']}[ph]).map((t,i) => html`
            <div key=${i} style="display:flex;align-items:center;gap:12px;border-radius:16px;padding:12px;background:var(--tg-secondary-bg)">
              <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${c};display:flex;align-items:center;justify-content:center;flex-shrink:0"><div style="width:10px;height:10px;border-radius:50%;background:${c}" /></div>
              <span style="font-size:14px">${t}</span>
            </div>
          `)}
        </div>
      `}
      ${tab==='body' && html`
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="border-radius:16px;padding:16px;background:${c}15">
            <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:${c};margin-bottom:4px">Спорт</div>
            <div style="font-size:14px">${NE.sport(ph)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${({menstruation:['Пилатес 20 мин','Йога Нидра','Растяжка','Прогулка 30 мин'],follicular:['Кроссфит WOD','Бег 5 км','Силовая','Танцы'],ovulation:['HIIT 15 мин','Боевые искусства','Командный спорт','Плавание'],luteal:['Йога для ПМС','Плавание','Пилатес','Медитация в движении']}[ph]).map((e,i) => html`
              <div key=${i} style="border-radius:16px;padding:12px;text-align:center;font-size:14px;background:var(--tg-secondary-bg)">${e}</div>
            `)}
          </div>
          <div style="border-radius:16px;padding:16px;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.15)">
            <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:#f43f5e;margin-bottom:4px">Интимность</div>
            <div style="font-size:14px">${NE.intim(ph)}</div>
          </div>
        </div>
      `}
      ${tab==='food' && html`
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="border-radius:16px;padding:16px;background:${c}15">
            <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:${c};margin-bottom:4px">Питание фазы</div>
            <div style="font-size:14px">${NE.food(ph)}</div>
          </div>
          ${({menstruation:[{n:'Говяжья печень',b:'Железо + B12'},{n:'Шпинат',b:'Фолиевая кислота'},{n:'Гранат',b:'Витамин C'},{n:'Тёплый бульон',b:'Уют и минералы'}],follicular:[{n:'Лосось',b:'Омега-3 + белок'},{n:'Брокколи',b:'Эстроген-детокс'},{n:'Кефир',b:'Пробиотики'},{n:'Авокадо',b:'Здоровые жиры'}],ovulation:[{n:'Помидоры',b:'Ликопен'},{n:'Орехи',b:'Цинк + селен'},{n:'Ягоды',b:'Антиоксиданты'},{n:'Оливковое масло',b:'Полифенолы'}],luteal:[{n:'Тёмный шоколад',b:'Магний'},{n:'Бананы',b:'Витамин B6'},{n:'Овсянка',b:'Сложные углеводы'},{n:'Чечевица',b:'Белок + железо'}]}[ph]).map((f,i) => html`
            <div key=${i} style="display:flex;justify-content:space-between;align-items:center;border-radius:16px;padding:12px;background:var(--tg-secondary-bg)">
              <span style="font-size:14px;font-weight:500">${f.n}</span>
              <span style="font-size:12px;color:var(--tg-hint)">${f.b}</span>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

function Calendar() {
  const [view, setView] = useState('calendar');
  const [logs, setLogs] = useState(store.getState().logs);
  useEffect(() => store.sub(s => setLogs(s.logs)), []);
  const days = useMemo(() => {
    const lps = store.getState().lastPeriodStart;
    if (!lps) return [];
    const start = new Date(lps);
    const res = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const dn = i + 1;
      const ph = NE.phase(dn);
      res.push({ date: d, dayNum: dn, phase: ph, color: NE.pc(ph) });
    }
    return res;
  }, [store.getState().lastPeriodStart]);
  const today = new Date().getDate();
  const tMonth = new Date().getMonth();
  const stats = useMemo(() => {
    const entries = Object.values(logs);
    if (!entries.length) return null;
    const avg = k => entries.reduce((s, l) => s + l[k], 0) / entries.length;
    return { energy: avg('energyLevel'), anxiety: avg('anxietyLevel'), sleep: avg('sleepQuality'), libido: avg('libidoLevel'), count: entries.length };
  }, [logs]);
  return html`
    <div style="padding:24px 16px 16px;display:flex;flex-direction:column;gap:16px;background:var(--tg-bg);color:var(--tg-text)">
      <h1 style="font-size:24px;font-weight:500">Календарь</h1>
      <p style="font-size:14px;color:var(--tg-hint)">Визуализация цикла и симптомов</p>
      <div style="display:flex;gap:8px;padding:4px;border-radius:12px;background:var(--tg-secondary-bg)">
        <button onClick=${()=>setView('calendar')} style="flex:1;padding:8px;border-radius:8px;border:none;background:${view==='calendar'?'var(--tg-bg)':'transparent'};color:${view==='calendar'?'var(--tg-text)':'var(--tg-hint)'};font-size:14px;font-weight:500">Месяц</button>
        <button onClick=${()=>setView('stats')} style="flex:1;padding:8px;border-radius:8px;border:none;background:${view==='stats'?'var(--tg-bg)':'transparent'};color:${view==='stats'?'var(--tg-text)':'var(--tg-hint)'};font-size:14px;font-weight:500">Статистика</button>
      </div>
      ${view==='calendar' && html`
        <div style="border-radius:16px;padding:16px;background:var(--tg-secondary-bg)">
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">
            ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => html`<div key=${d} style="text-align:center;font-size:10px;color:var(--tg-hint);padding:4px 0">${d}</div>`)}
            ${days.map(d => {
              const isToday = d.date.getDate() === today && d.date.getMonth() === tMonth;
              return html`
                <div key=${d.dayNum} style="aspect-ratio:1/1;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${d.color}20;box-shadow:${isToday?'inset 0 0 0 2px var(--tg-text)':'none'}">
                  <span style="font-size:12px;font-weight:500;color:${d.color}">${d.date.getDate()}</span>
                  <span style="font-size:8px;color:var(--tg-hint)">${d.dayNum}д</span>
                </div>
              `;
            })}
          </div>
          <div style="display:flex;justify-content:center;gap:12px;margin-top:16px;flex-wrap:wrap">
            ${[['menstruation','Менструация'],['follicular','Фолликулярная'],['ovulation','Овуляция'],['luteal','Лютеиновая']].map(p => html`
              <div key=${p[0]} style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:50%;background:${NE.pc(p[0])}" /><span style="font-size:10px;color:var(--tg-hint)">${p[1]}</span></div>
            `)}
          </div>
        </div>
      `}
      ${view==='stats' && (!stats ? html`
        <div style="border-radius:16px;padding:32px;text-align:center;font-size:14px;background:var(--tg-secondary-bg);color:var(--tg-hint)">Пока недостаточно данных. Заполни несколько чек-инов.</div>
      ` : html`
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="text-align:center;font-size:12px;color:var(--tg-hint)">На основе ${stats.count} записей</div>
          ${[{l:'Энергия',v:stats.energy,c:'#10B981'},{l:'Тревожность',v:stats.anxiety,c:'#EF4444'},{l:'Сон',v:stats.sleep,c:'#6366F1'},{l:'Либидо',v:stats.libido,c:'#EC4899'}].map(m => html`
            <div key=${m.l} style="border-radius:16px;padding:16px;background:var(--tg-secondary-bg)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:14px;font-weight:500">${m.l}</span>
                <span style="font-size:14px;font-weight:500;color:${m.c}">${m.v.toFixed(1)} / 5</span>
              </div>
              <div style="height:12px;border-radius:999px;overflow:hidden;background:var(--tg-bg)">
                <div style="height:100%;border-radius:999px;background:${m.c};width:${(m.v/5)*100}%;transition:width 0.5s" />
              </div>
            </div>
          `)}
        </div>
      `)}
    </div>
  `;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const defaultLog = {
  date: todayStr(), isPeriod: false, energyLevel: 3, focusLevel: 3, anxietyLevel: 2,
  mood: 'calm', libidoLevel: 2, intimacy: { occurred: false, type: 'none', protection: null, orgasm: false, discomfort: false },
  sleepQuality: 3, symptoms: [], cervicalMucus: 'dry',
};

function CheckIn({ onClose }) {
  const [step, setStep] = useState('brain');
  const draft = store.getState().draftLog;
  const [log, setLog] = useState(() => draft && draft.date === todayStr() ? { ...defaultLog, ...draft } : { ...defaultLog });
  useEffect(() => { store.setDraft(log); }, [log]);
  const steps = [{k:'brain',l:'Мозг'},{k:'intimacy',l:'Интим'},{k:'body',l:'Тело'}];
  const si = steps.findIndex(s => s.k === step);
  const next = () => {
    haptic();
    if (step === 'brain') setStep('intimacy');
    else if (step === 'intimacy') setStep('body');
    else { store.addLog({ ...defaultLog, ...log }); store.clearDraft(); notify(); onClose(); }
  };
  const back = () => {
    haptic();
    if (step === 'brain') {
      if (tg?.showConfirm) tg.showConfirm('Сохранить введённые данные?', ok => { if (!ok) store.clearDraft(); onClose(); });
      else onClose();
    } else if (step === 'intimacy') setStep('brain');
    else setStep('intimacy');
  };
  const upd = p => setLog(prev => ({ ...prev, ...p }));

  const moods = [{k:'euphoric',l:'Эйфория',e:'🤩'},{k:'calm',l:'Спокойствие',e:'😌'},{k:'irritated',l:'Раздражение',e:'😤'},{k:'sad',l:'Грусть',e:'😢'},{k:'anxious',l:'Тревога',e:'😰'},{k:'numb',l:'Апатия',e:'😶'}];
  const slider = (label, key, max=5) => html`
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;font-size:14px"><span>${label}</span><span style="font-weight:500">${log[key]}/${max}</span></div>
      <input type="range" min="0" max=${max} step="1" value=${log[key]} onInput=${e=>{haptic();upd({[key]:+e.target.value});}} style="width:100%" />
    </div>
  `;
  const symptoms = [{k:'cramps',l:'Спазмы',i:'⚡'},{k:'bloating',l:'Вздутие',i:'🎈'},{k:'headache',l:'Головная боль',i:'🤕'},{k:'breast_tenderness',l:'Чувствительность груди',i:'💗'},{k:'acne',l:'Высыпания',i:'🔴'},{k:'fatigue',l:'Усталость',i:'😴'},{k:'insomnia',l:'Бессонница',i:'🌃'},{k:'cravings',l:'Тяга к сладкому',i:'🍫'}];
  const mucus = [{k:'dry',l:'Сухо',d:'Нет выделений'},{k:'sticky',l:'Липкие',d:'Густые, белые'},{k:'creamy',l:'Кремовые',d:'Молочные, влажные'},{k:'egg_white',l:'Яичный белок',d:'Прозрачные, тянущиеся'}];
  const toggleSym = key => {
    haptic();
    const cur = log.symptoms || [];
    upd({ symptoms: cur.includes(key) ? cur.filter(s => s !== key) : [...cur, key] });
  };

  return html`
    <div style="position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--tg-bg);color:var(--tg-text)">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 16px 8px;border-top:1px solid var(--tg-secondary-bg)">
        <button onClick=${back} style="font-size:14px;padding:4px 8px;background:none;border:none;color:var(--tg-hint)">${step==='brain'?'Отмена':'Назад'}</button>
        <div style="display:flex;gap:4px">
          ${steps.map((s,i) => html`<div key=${s.k} style="width:32px;height:4px;border-radius:999px;background:${si>=i?'var(--tg-button)':'var(--tg-secondary-bg)'}" />`)}
        </div>
        <button onClick=${next} style="font-size:14px;font-weight:500;padding:4px 8px;background:none;border:none;color:var(--tg-button)">${step==='body'?'Сохранить':'Далее'}</button>
      </div>
      <div style="flex:1;overflow-y:auto">
        ${step==='brain' && html`
          <div style="padding:16px;display:flex;flex-direction:column;gap:24px">
            <h3 style="font-size:18px;font-weight:500;text-align:center">Мозг и энергия</h3>
            ${slider('Энергия','energyLevel')}
            ${slider('Фокус','focusLevel')}
            ${slider('Тревожность (кортизол)','anxietyLevel')}
            ${slider('Качество сна','sleepQuality')}
            <div style="display:flex;flex-direction:column;gap:8px">
              <span style="font-size:14px;color:var(--tg-hint)">Настроение</span>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                ${moods.map(m => html`
                  <button key=${m.k} onClick=${()=>{haptic('medium');upd({mood:m.k});}} style="padding:12px;border-radius:12px;border:2px solid ${log.mood===m.k?'var(--tg-button)':'var(--tg-secondary-bg)'};background:${log.mood===m.k?'var(--tg-secondary-bg)':'transparent'};font-size:12px">
                    <div style="font-size:24px">${m.e}</div><div>${m.l}</div>
                  </button>
                `)}
              </div>
            </div>
          </div>
        `}
        ${step==='intimacy' && html`
          <div style="padding:16px;display:flex;flex-direction:column;gap:24px">
            <h3 style="font-size:18px;font-weight:500;text-align:center">Интимность и тело</h3>
            <div>
              <div style="font-size:14px;color:var(--tg-hint);text-align:center;margin-bottom:12px">Уровень либидо</div>
              <div style="display:flex;justify-content:space-between;align-items:flex-end;height:96px;gap:8px">
                ${[0,1,2,3,4].map(lvl => html`
                  <button key=${lvl} onClick=${()=>{haptic('medium');upd({libidoLevel:lvl});}} style="flex:1;border-radius:12px;border:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:8px;height:${40+lvl*18}%;background:${log.libidoLevel>=lvl?'rgba(244,63,94,0.15)':'var(--tg-secondary-bg)'};border:2px solid ${log.libidoLevel>=lvl?'rgba(244,63,94,0.3)':'transparent'}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color:${log.libidoLevel>=lvl?'#f43f5e':'var(--tg-hint)'}">
                      <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" stroke="currentColor" stroke-width="1.5" fill=${log.libidoLevel>=lvl?'currentColor':'none'} />
                    </svg>
                  </button>
                `)}
              </div>
              <div style="text-align:center;font-size:14px;color:var(--tg-hint);margin-top:8px">${['Спит','Тихо','Возможно','Желание','На пределе'][log.libidoLevel]}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <span style="font-size:14px;color:var(--tg-hint)">Была интимность?</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${[{k:'none',l:'Нет',i:'🌙'},{k:'solo',l:'Соло',i:'✨'},{k:'partner',l:'С партнёром',i:'🔮'}].map(opt => html`
                  <button key=${opt.k} onClick=${()=>{haptic('medium');upd({intimacy:{...log.intimacy,occurred:opt.k!=='none',type:opt.k}});}} style="padding:16px;border-radius:12px;border:2px solid ${(opt.k==='none'&&!log.intimacy.occurred)||(opt.k!=='none'&&log.intimacy.occurred&&log.intimacy.type===opt.k)?'rgba(244,63,94,0.4)':'var(--tg-secondary-bg)'};background:${(opt.k==='none'&&!log.intimacy.occurred)||(opt.k!=='none'&&log.intimacy.occurred&&log.intimacy.type===opt.k)?'rgba(244,63,94,0.08)':'transparent'};font-size:14px;font-weight:500;text-align:center">
                    <div style="font-size:24px">${opt.i}</div>${opt.l}
                  </button>
                `)}
              </div>
            </div>
            ${log.intimacy.occurred && html`
              <div style="display:flex;flex-direction:column;gap:16px">
                <button onClick=${()=>{upd({intimacy:{...log.intimacy,orgasm:!log.intimacy.orgasm}});if(!log.intimacy.orgasm){notify('success');tg?.showAlert?.('Окситоциновый буст получен. Уровень кортизола снижен на 30% на 12 часов.');}}} style="padding:12px;border-radius:12px;border:2px solid ${log.intimacy.orgasm?'rgba(245,158,11,0.5)':'var(--tg-secondary-bg)'};background:${log.intimacy.orgasm?'rgba(245,158,11,0.08)':'transparent'};font-size:14px;font-weight:500">
                  ${log.intimacy.orgasm?'✓ Оргазм отмечен':'Отметить оргазм'}
                </button>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  ${[{k:'protected',l:'С защитой'},{k:'unprotected',l:'Без защиты'}].map(p => html`
                    <button key=${p.k} onClick=${()=>upd({intimacy:{...log.intimacy,protection:p.k}})} style="padding:12px;border-radius:12px;border:2px solid ${log.intimacy.protection===p.k?'rgba(139,92,246,0.5)':'var(--tg-secondary-bg)'};background:${log.intimacy.protection===p.k?'rgba(139,92,246,0.08)':'transparent'};font-size:14px">${p.l}</button>
                  `)}
                </div>
                <button onClick=${()=>upd({intimacy:{...log.intimacy,discomfort:!log.intimacy.discomfort}})} style="padding:12px;border-radius:12px;border:2px solid ${log.intimacy.discomfort?'rgba(249,115,22,0.5)':'var(--tg-secondary-bg)'};background:${log.intimacy.discomfort?'rgba(249,115,22,0.08)':'transparent'};font-size:14px">
                  ${log.intimacy.discomfort?'⚠ Дискомфорт отмечен':'Отметить дискомфорт'}
                </button>
              </div>
            `}
          </div>
        `}
        ${step==='body' && html`
          <div style="padding:16px;display:flex;flex-direction:column;gap:24px">
            <h3 style="font-size:18px;font-weight:500;text-align:center">Тело и симптомы</h3>
            <div style="display:flex;justify-content:space-between;align-items:center;border-radius:12px;padding:16px;background:var(--tg-secondary-bg)">
              <div>
                <div style="font-size:14px;font-weight:500">Менструация сегодня</div>
                <div style="font-size:12px;color:var(--tg-hint)">Отметь, если идут кровотечения</div>
              </div>
              <button onClick=${()=>{haptic('medium');upd({isPeriod:!log.isPeriod});}} style="width:48px;height:28px;border-radius:999px;border:none;position:relative;background:${log.isPeriod?'#EF4444':'var(--tg-hint)'}">
                <div style="position:absolute;width:24px;height:24px;border-radius:50%;background:white;top:2px;transition:transform 0.2s;transform:translateX(${log.isPeriod?20:2}px);box-shadow:0 1px 3px rgba(0,0,0,0.2)" />
              </button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <span style="font-size:14px;color:var(--tg-hint)">Шейная слизь</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${mucus.map(m => html`
                  <button key=${m.k} onClick=${()=>{haptic();upd({cervicalMucus:m.k});}} style="padding:12px;border-radius:12px;border:2px solid ${log.cervicalMucus===m.k?'rgba(59,130,246,0.5)':'var(--tg-secondary-bg)'};background:${log.cervicalMucus===m.k?'rgba(59,130,246,0.08)':'transparent'};text-align:left;font-size:14px">
                    <div style="font-weight:500">${m.l}</div><div style="font-size:12px;color:var(--tg-hint)">${m.d}</div>
                  </button>
                `)}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <span style="font-size:14px;color:var(--tg-hint)">Симптомы</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${symptoms.map(s => html`
                  <button key=${s.k} onClick=${()=>toggleSym(s.k)} style="padding:12px;border-radius:12px;border:2px solid ${log.symptoms?.includes(s.k)?'var(--tg-button)':'var(--tg-secondary-bg)'};background:${log.symptoms?.includes(s.k)?'var(--tg-secondary-bg)':'transparent'};text-align:center;font-size:12px">
                    <div style="font-size:20px">${s.i}</div><div>${s.l}</div>
                  </button>
                `)}
              </div>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [lps, setLps] = useState(store.getState().lastPeriodStart);
  useEffect(() => {
    const unsub = store.sub(s => setLps(s.lastPeriodStart));
    const uid = tg?.initDataUnsafe?.user?.id;
    initStore(uid ? uid.toString() : 'guest');
    return unsub;
  }, []);
  const changeTab = t => { haptic(); setTab(t); };
  if (!lps) return html`<${Onboarding} />`;
  return html`
    <div style="background:var(--tg-bg);color:var(--tg-text);min-height:100vh;padding-bottom:80px">
      ${tab==='dashboard' && html`<${Dashboard} onCheckIn=${()=>setCheckInOpen(true)} />`}
      ${tab==='planner' && html`<${Planner} />`}
      ${tab==='calendar' && html`<${Calendar} />`}
      ${checkInOpen && html`<${CheckIn} onClose=${()=>setCheckInOpen(false)} />`}
      <nav style="position:fixed;bottom:0;left:0;right:0;background:var(--tg-bg);border-top:1px solid var(--tg-secondary-bg);z-index:50;display:flex;justify-content:space-around;padding:8px 0">
        ${[{k:'dashboard',l:'Главная',i:'◉'},{k:'planner',l:'Планер',i:'☰'},{k:'calendar',l:'Календарь',i:'◎'}].map(t => html`
          <button key=${t.k} onClick=${()=>changeTab(t.k)} style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 24px;border-radius:8px;border:none;background:none;color:${tab===t.k?'var(--tg-text)':'var(--tg-hint)'};font-weight:${tab===t.k?500:400};font-size:10px">
            <span style="font-size:18px">${t.i}</span>${t.l}
          </button>
        `)}
      </nav>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
