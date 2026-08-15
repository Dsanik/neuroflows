import { render } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { html } from 'htm/preact';

// ===== TELEGRAM THEME =====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  const r = document.documentElement.style;
  const p = tg.themeParams;
  r.setProperty('--tg-bg', p.bg_color || '#ffffff');
  r.setProperty('--tg-text', p.text_color || '#000000');
  r.setProperty('--tg-hint', p.hint_color || '#999999');
  r.setProperty('--tg-button', p.button_color || '#000000');
  r.setProperty('--tg-button-text', p.button_text_color || '#ffffff');
  r.setProperty('--tg-secondary-bg', p.secondary_bg_color || '#f5f5f5');
}

// ===== STORE =====
const STORAGE_KEY = 'nf_v1';
let listeners = [];
let state = { profile: null, logs: {}, lastPeriodStart: null, currentProfile: null, draftLog: null };

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) state = { ...state, ...JSON.parse(raw) };
} catch(e) {}

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const notify = () => listeners.forEach(l => l(state));

const store = {
  getState: () => state,
  subscribe: (cb) => { listeners.push(cb); return () => { listeners = listeners.filter(l => l !== cb); }; },
  setProfile: (p) => { state.profile = p; save(); notify(); },
  setLastPeriodStart: (d) => { state.lastPeriodStart = d; save(); notify(); computeProfile(); },
  addLog: (log) => { state.logs[log.date] = log; save(); notify(); },
  getLog: (d) => state.logs[d],
  setDraftLog: (log) => { state.draftLog = log; save(); notify(); },
  clearDraftLog: () => { state.draftLog = null; save(); notify(); },
};

function computeProfile() {
  const { profile, lastPeriodStart } = state;
  if (!profile || !lastPeriodStart) return;
  const day = NeuroEngine.getDayOfCycle(lastPeriodStart, profile.averageCycleLength);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yLog = state.logs[y.toISOString().split('T')[0]];
  state.currentProfile = NeuroEngine.getProfile(day, profile.averageCycleLength, yLog?.sleepQuality ?? 4);
  save();
  notify();
}

function initStore(tgId) {
  if (!state.profile) {
    state.profile = { tgId, averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14, neuroSensitivity: 'medium', onContraception: false };
    save();
  }
  computeProfile();
}

// ===== NEURO ENGINE =====
const NeuroEngine = {
  getEstrogen(d, L = 28) {
    const ov = L - 14;
    if (d <= ov) return Math.exp(-Math.pow(d - ov, 2) / 10);
    return 0.3 + 0.4 * Math.exp(-Math.pow(d - (ov + 7), 2) / 15);
  },
  getProgesterone(d, L = 28) {
    const ov = L - 14;
    if (d <= ov) return 0.05;
    return Math.max(0, Math.sin((Math.PI * (d - ov)) / 14));
  },
  getTestosterone(d, L = 28) {
    const ov = L - 14;
    return Math.exp(-Math.pow(d - ov, 2) / 4);
  },
  calculateCNSCapacity(e, p, recentSleep = 4) {
    let base = e * 0.6 - p * 0.3 + 0.5;
    return Math.min(100, Math.max(0, base * 50 + recentSleep * 10));
  },
  getPhase(d, L = 28) {
    if (d <= 5) return 'menstruation';
    if (d <= 13) return 'follicular';
    if (d <= 16) return 'ovulation';
    return 'luteal';
  },
  getDayOfCycle(lastPeriodStart, cycleLength = 28) {
    const start = new Date(lastPeriodStart);
    const now = new Date();
    const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const day = (diff % cycleLength) + 1;
    return day > 0 ? day : 1;
  },
  getProfile(day, cycleLength = 28, recentSleep = 4) {
    const e = this.getEstrogen(day, cycleLength);
    const p = this.getProgesterone(day, cycleLength);
    const t = this.getTestosterone(day, cycleLength);
    return {
      estrogen: e, progesterone: p, testosterone: t,
      cnsCapacity: this.calculateCNSCapacity(e, p, recentSleep),
      phase: this.getPhase(day, cycleLength), dayOfCycle: day,
    };
  },
  getPhaseColor(phase) {
    return { menstruation: '#10B981', follicular: '#F59E0B', ovulation: '#EF4444', luteal: '#6366F1' }[phase];
  },
  getPhaseName(phase) {
    return { menstruation: 'Менструация', follicular: 'Фолликулярная', ovulation: 'Овуляция', luteal: 'Лютеиновая' }[phase];
  },
  getInsight(phase, day) {
    switch(phase) {
      case 'menstruation': return 'Прогестерон и эстроген на минимуме. Энергия низкая, ЦНС восстанавливается. Фокус на рутину, отдых и лёгкий пилатес.';
      case 'follicular': return 'Эстроген растёт, дофаминовые рецепторы активируются. Идеальное время для новых проектов, обучения и кроссфита.';
      case 'ovulation': return `День ${day}: тестостерон и эстроген на абсолютном пике. Вербальные навыки, уверенность и либидо максимальны.`;
      case 'luteal': return 'Прогестерон доминирует, ГАМК седирует. Возможен глубокий фокус, но следите за тревожностью. Углеводное окно активно.';
    }
  },
  getWorkRecommendation(phase) {
    return { menstruation: 'Рутинные задачи, отложенные дела, планирование', follicular: 'Новые проекты, обучение, переговоры, креатив', ovulation: 'Публичные выступления, продажи, нетворкинг', luteal: 'Глубокий анализ, завершение задач, ревизия' }[phase];
  },
  getSportRecommendation(phase) {
    return { menstruation: 'Пилатес, йога, растяжка, прогулки', follicular: 'Кроссфит, бег, силовые, новые виды спорта', ovulation: 'HIIT, танцы, командные виды спорта', luteal: 'Йога, плавание, пилатес, низкая интенсивность' }[phase];
  },
  getFoodRecommendation(phase) {
    return { menstruation: 'Железо (печень, шпинат), витамин C, тёплая еда', follicular: 'Белок, зелень, пробиотики, лёгкая пища', ovulation: 'Овощи, антиоксиданты, омега-3, салаты', luteal: 'Сложные углеводы, магний (тёмный шоколад), витамин B6' }[phase];
  },
  getIntimacyRecommendation(phase) {
    return { menstruation: 'Реактивное либидо, длинная прелюдия, нежность', follicular: 'Спонтанное желание, эксперименты, игривость', ovulation: 'Пик либидо, фертильность максимальна, страсть', luteal: 'Мягкость, эмоциональная близость, уют' }[phase];
  },
};

// ===== COMPONENTS =====

function Onboarding() {
  const [date, setDate] = useState('');
  const [cycle, setCycle] = useState(28);
  const [period, setPeriod] = useState(5);

  const handleStart = () => {
    if (!date) return;
    tg?.HapticFeedback?.impactOccurred?.('medium');
    const prof = store.getState().profile;
    if (prof) store.setProfile({ ...prof, averageCycleLength: cycle, averagePeriodLength: period });
    store.setLastPeriodStart(date);
    tg?.HapticFeedback?.notificationOccurred?.('success');
  };

  return html`
    <div class="fx fxc jcc px4 py8 s6 anim" style="min-height:100vh">
      <div class="tc s3">
        <div class="x3">🧠</div>
        <h1 class="x2 semi">NeuroFlow</h1>
        <p class="sm rel hint">Трекер цикла, который подстраивается под твою нейро-гормональную биологию</p>
      </div>
      <div class="s5">
        <div class="s2">
          <label class="sm med">Дата начала последней менструации</label>
          <input type="date" value=${date} onInput=${e => setDate(e.target.value)}
            class="w100 p3 r12 b2" style="background:var(--tg-secondary-bg);border-color:${date?'var(--tg-button)':'var(--tg-secondary-bg)'};color:var(--tg-text)" />
        </div>
        <div class="s2">
          <div class="fx jcsb sm"><span class="med">Длина цикла</span><span class="hint">${cycle} дней</span></div>
          <input type="range" min="21" max="35" value=${cycle} onInput=${e => setCycle(+e.target.value)} class="w100" />
        </div>
        <div class="s2">
          <div class="fx jcsb sm"><span class="med">Длина периода</span><span class="hint">${period} дней</span></div>
          <input type="range" min="2" max="8" value=${period} onInput=${e => setPeriod(+e.target.value)} class="w100" />
        </div>
      </div>
      <button onClick=${handleStart} disabled=${!date}
        class="w100 py4 r12 semi text-white active" style="background:var(--tg-button);opacity:${date?1:0.4}">
        Начать
      </button>
    </div>
  `;
}

function HormoneRing({ profile }) {
  if (!profile) return null;
  const { dayOfCycle, phase, cnsCapacity } = profile;
  const color = NeuroEngine.getPhaseColor(phase);
  const circ = 2 * Math.PI * 90;
  const prog = (dayOfCycle / 28) * circ;
  return html`
    <div class="rel2 w56 h56 mx4 my4" style="width:224px;height:224px;margin:16px auto">
      <svg viewBox="0 0 200 200" class="w100 h100">
        <circle cx="100" cy="100" r="90" fill="none" stroke-width="12" style="stroke:var(--tg-secondary-bg)" />
        <circle cx="100" cy="100" r="90" fill="none" stroke=${color} stroke-width="12" stroke-linecap="round"
          stroke-dasharray=${circ} stroke-dashoffset=${circ - prog} transform="rotate(-90 100 100)"
          style="transition:stroke-dashoffset 1.2s ease-out" />
      </svg>
      <div class="abs in0 fx fxc jcc">
        <div class="x4 med tab" style="color:${color}">${dayOfCycle}</div>
        <div class="xs hint">${NeuroEngine.getPhaseName(phase)}</div>
        <div class="x8 hint">ЦНС: ${Math.round(cnsCapacity)}%</div>
      </div>
    </div>
  `;
}

function HormoneGauges({ profile }) {
  if (!profile) return null;
  const { estrogen, progesterone, testosterone } = profile;
  const hs = [
    { n: 'Эстроген', v: estrogen, c: '#EC4899' },
    { n: 'Прогестерон', v: progesterone, c: '#8B5CF6' },
    { n: 'Тестостерон', v: testosterone, c: '#F59E0B' },
  ];
  return html`
    <div class="r16 p4 s3" style="background:var(--tg-secondary-bg)">
      <h3 class="sm med hint">Уровень гормонов</h3>
      ${hs.map((h, i) => html`
        <div class="s1" key=${i}>
          <div class="fx jcsb xs"><span class="txt">${h.n}</span><span class="med" style="color:${h.c}">${Math.round(h.v*100)}%</span></div>
          <div class="h2 r8 oh" style="background:var(--tg-bg)">
            <div class="h2 r8" style="width:${h.v*100}%;background:${h.c};transition:width 0.8s ${i*0.15}s" />
          </div>
        </div>
      `)}
    </div>
  `;
}

function BrainStatusBadge({ profile }) {
  if (!profile) return null;
  const { cnsCapacity, phase } = profile;
  const color = NeuroEngine.getPhaseColor(phase);
  const st = cns >= 80 ? { l: 'Пик производительности', e: '🚀' }
    : cns >= 60 ? { l: 'Высокий ресурс', e: '⚡' }
    : cns >= 40 ? { l: 'Средний ресурс', e: '💡' }
    : cns >= 20 ? { l: 'Низкий ресурс', e: '🌙' }
    : { l: 'Восстановление', e: '🛌' };
  return html`
    <div class="r16 p4 fx aic g3" style="background:${color}15">
      <div class="x2">${st.e}</div>
      <div>
        <div class="sm med" style="color:${color}">${st.l}</div>
        <div class="xs hint">ЦНС загружен на ${Math.round(cnsCapacity)}%</div>
      </div>
    </div>
  `;
}

function NeuroInsightCard({ profile }) {
  if (!profile) return null;
  return html`
    <div class="r16 p4 shadow" style="background:var(--tg-secondary-bg)">
      <h3 class="sm med hint mb2">Нейро-инсайт</h3>
      <p class="sm rel txt">${NeuroEngine.getInsight(profile.phase, profile.dayOfCycle)}</p>
    </div>
  `;
}

function NeuroDashboard({ onCheckIn }) {
  const [profile, setProfile] = useState(store.getState().currentProfile);
  useEffect(() => store.subscribe(s => setProfile(s.currentProfile)), []);
  return html`
    <div class="px4 pt6 pb4 s4">
      <div class="fx jcsb aic">
        <div>
          <h1 class="x2 med txt">NeuroFlow</h1>
          <p class="sm hint">Твой нейро-гормональный профиль</p>
        </div>
        <button onClick=${onCheckIn} class="px4 py2 r12 sm med text-white active" style="background:var(--tg-button)">Чек-ин</button>
      </div>
      <div class="anim"><${HormoneRing} profile=${profile} /></div>
      <div class="anim" style="animation-delay:.1s"><${HormoneGauges} profile=${profile} /></div>
      <div class="anim" style="animation-delay:.2s"><${BrainStatusBadge} profile=${profile} /></div>
      <div class="anim" style="animation-delay:.3s"><${NeuroInsightCard} profile=${profile} /></div>
    </div>
  `;
}

function WorkTab({ phase }) {
  const color = NeuroEngine.getPhaseColor(phase);
  const tasks = {
    menstruation: ['Ответить на отложенные письма','Обновить to-do список','Провести ретроспективу месяца','Организовать рабочее пространство'],
    follicular: ['Запустить новый проект','Провести мозговой штурм','Изучить новый инструмент','Начать курс / обучение'],
    ovulation: ['Провести важные переговоры','Выступить на публике','Закрыть сделку','Нетворкинг и митапы'],
    luteal: ['Завершить текущие задачи','Провести аудит процессов','Написать документацию','Подготовить отчёты'],
  };
  return html`
    <div class="s4">
      <div class="r16 p4" style="background:${color}15">
        <div class="xs med up track mb1" style="color:${color}">Рекомендация фазы</div>
        <div class="sm txt">${NeuroEngine.getWorkRecommendation(phase)}</div>
      </div>
      <div class="s2">
        ${tasks[phase].map((t,i) => html`
          <div key=${i} class="fx aic g3 r16 p3" style="background:var(--tg-secondary-bg)">
            <div class="w5 h5 rf b2 fx jcc aic" style="border-color:${color}"><div class="w2 h2 rf" style="background:${color}" /></div>
            <span class="sm txt">${t}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

function BodyIntimacyTab({ phase }) {
  const color = NeuroEngine.getPhaseColor(phase);
  const ex = {
    menstruation: ['Пилатес 20 мин','Йога Нидра','Растяжка','Прогулка 30 мин'],
    follicular: ['Кроссфит WOD','Бег 5 км','Силовая тренировка','Танцы'],
    ovulation: ['HIIT 15 мин','Боевые искусства','Командный спорт','Плавание'],
    luteal: ['Йога для ПМС','Плавание','Пилатес','Медитация в движении'],
  };
  return html`
    <div class="s4">
      <div class="r16 p4" style="background:${color}15">
        <div class="xs med up track mb1" style="color:${color}">Спорт</div>
        <div class="sm txt">${NeuroEngine.getSportRecommendation(phase)}</div>
      </div>
      <div class="gr gr2 g2">
        ${ex[phase].map((e,i) => html`<div key=${i} class="r16 p3 tc sm txt" style="background:var(--tg-secondary-bg)">${e}</div>`)}
      </div>
      <div class="r16 p4" style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.15)">
        <div class="xs med up track mb1" style="color:#f43f5e">Интимность</div>
        <div class="sm txt">${NeuroEngine.getIntimacyRecommendation(phase)}</div>
      </div>
    </div>
  `;
}

function FoodTab({ phase }) {
  const color = NeuroEngine.getPhaseColor(phase);
  const foods = {
    menstruation: [{n:'Говяжья печень',b:'Железо + B12'},{n:'Шпинат',b:'Фолиевая кислота'},{n:'Гранат',b:'Витамин C'},{n:'Тёплый бульон',b:'Уют и минералы'}],
    follicular: [{n:'Лосось',b:'Омега-3 + белок'},{n:'Брокколи',b:'Эстроген-детокс'},{n:'Кефир',b:'Пробиотики'},{n:'Авокадо',b:'Здоровые жиры'}],
    ovulation: [{n:'Помидоры',b:'Ликопен'},{n:'Орехи',b:'Цинк + селен'},{n:'Ягоды',b:'Антиоксиданты'},{n:'Оливковое масло',b:'Полифенолы'}],
    luteal: [{n:'Тёмный шоколад',b:'Магний'},{n:'Бананы',b:'Витамин B6'},{n:'Овсянка',b:'Сложные углеводы'},{n:'Чечевица',b:'Белок + железо'}],
  };
  return html`
    <div class="s4">
      <div class="r16 p4" style="background:${color}15">
        <div class="xs med up track mb1" style="color:${color}">Питание фазы</div>
        <div class="sm txt">${NeuroEngine.getFoodRecommendation(phase)}</div>
      </div>
      <div class="s2">
        ${foods[phase].map((f,i) => html`
          <div key=${i} class="fx jcsb aic r16 p3" style="background:var(--tg-secondary-bg)">
            <span class="sm med txt">${f.n}</span>
            <span class="xs hint">${f.b}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

function NeuroPlanner() {
  const [tab, setTab] = useState('work');
  const [profile, setProfile] = useState(store.getState().currentProfile);
  useEffect(() => store.subscribe(s => setProfile(s.currentProfile)), []);
  if (!profile) return html`<div class="fx jcc aic" style="height:256px;color:var(--tg-hint)">Загрузка профиля...</div>`;
  const tabs = [{k:'work',l:'Работа'},{k:'body',l:'Тело'},{k:'food',l:'Питание'}];
  return html`
    <div class="px4 pt6 pb4 s4">
      <h1 class="x2 med txt">Планер</h1>
      <p class="sm hint">Адаптация под текущую фазу</p>
      <div class="fx g2 p1 r12" style="background:var(--tg-secondary-bg)">
        ${tabs.map(t => html`
          <button key=${t.k} onClick=${() => {tg?.HapticFeedback?.impactOccurred?.('light');setTab(t.k);}}
            class="f1 py2 r8 sm med tall"
            style="background:${tab===t.k?'var(--tg-bg)':'transparent'};color:${tab===t.k?'var(--tg-text)':'var(--tg-hint)'};box-shadow:${tab===t.k?'0 1px 3px rgba(0,0,0,.08)':'none'}">
            ${t.l}
          </button>
        `)}
      </div>
      ${tab==='work' && html`<${WorkTab} phase=${profile.phase} />`}
      ${tab==='body' && html`<${BodyIntimacyTab} phase=${profile.phase} />`}
      ${tab==='food' && html`<${FoodTab} phase=${profile.phase} />`}
    </div>
  `;
}

function MonthGrid() {
  const lastPeriodStart = store.getState().lastPeriodStart;
  const days = useMemo(() => {
    if (!lastPeriodStart) return [];
    const start = new Date(lastPeriodStart);
    const res = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const dn = i + 1;
      const ph = NeuroEngine.getPhase(dn);
      res.push({ date: d, dayNum: dn, phase: ph, color: NeuroEngine.getPhaseColor(ph) });
    }
    return res;
  }, [lastPeriodStart]);
  const today = new Date().getDate();
  const tMonth = new Date().getMonth();
  return html`
    <div class="r16 p4" style="background:var(--tg-secondary-bg)">
      <div class="gr gr7 g1">
        ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => html`<div key=${d} class="tc x8 hint py1">${d}</div>`)}
        ${days.map(d => {
          const isToday = d.date.getDate() === today && d.date.getMonth() === tMonth;
          return html`
            <div key=${d.dayNum} class="sq r8 fx fxc jcc" style="background:${d.color}20;box-shadow:${isToday?'inset 0 0 0 2px var(--tg-text)':'none'}">
              <span class="sm med" style="color:${d.color}">${d.date.getDate()}</span>
              <span class="x8 hint">${d.dayNum}д</span>
            </div>
          `;
        })}
      </div>
      <div class="fx jcc g3 mt4 fxw">
        ${[['menstruation','Менструация'],['follicular','Фолликулярная'],['ovulation','Овуляция'],['luteal','Лютеиновая']].map(p => html`
          <div key=${p[0]} class="fx aic g1"><div class="w2 h2 rf" style="background:${NeuroEngine.getPhaseColor(p[0])}" /><span class="x8 hint">${p[1]}</span></div>
        `)}
      </div>
    </div>
  `;
}

function SymptomCorrelations() {
  const [logs, setLogs] = useState(store.getState().logs);
  useEffect(() => store.subscribe(s => setLogs(s.logs)), []);
  const stats = useMemo(() => {
    const entries = Object.values(logs);
    if (!entries.length) return null;
    const avg = k => entries.reduce((s,l) => s + l[k], 0) / entries.length;
    return { energy: avg('energyLevel'), anxiety: avg('anxietyLevel'), sleep: avg('sleepQuality'), libido: avg('libidoLevel'), count: entries.length };
  }, [logs]);
  if (!stats) return html`<div class="r16 p8 tc sm" style="background:var(--tg-secondary-bg);color:var(--tg-hint)">Пока недостаточно данных. Заполни несколько чек-инов.</div>`;
  const ms = [
    { l: 'Энергия', v: stats.energy, c: '#10B981' },
    { l: 'Тревожность', v: stats.anxiety, c: '#EF4444' },
    { l: 'Сон', v: stats.sleep, c: '#6366F1' },
    { l: 'Либидо', v: stats.libido, c: '#EC4899' },
  ];
  return html`
    <div class="s4">
      <div class="tc x8 hint">На основе ${stats.count} записей</div>
      ${ms.map(m => html`
        <div key=${m.l} class="r16 p4" style="background:var(--tg-secondary-bg)">
          <div class="fx jcsb aic mb2"><span class="sm med txt">${m.l}</span><span class="sm med" style="color:${m.c}">${m.v.toFixed(1)} / 5</span></div>
          <div class="h2 r8 oh" style="background:var(--tg-bg)"><div class="h2 r8" style="width:${(m.v/5)*100}%;background:${m.c};transition:width .5s" /></div>
        </div>
      `)}
    </div>
  `;
}

function CalendarData() {
  const [view, setView] = useState('calendar');
  return html`
    <div class="px4 pt6 pb4 s4">
      <h1 class="x2 med txt">Календарь</h1>
      <p class="sm hint">Визуализация цикла и симптомов</p>
      <div class="fx g2 p1 r12" style="background:var(--tg-secondary-bg)">
        <button onClick=${() => setView('calendar')} class="f1 py2 r8 sm med tall"
          style="background:${view==='calendar'?'var(--tg-bg)':'transparent'};color:${view==='calendar'?'var(--tg-text)':'var(--tg-hint)'}">Месяц</button>
        <button onClick=${() => setView('stats')} class="f1 py2 r8 sm med tall"
          style="background:${view==='stats'?'var(--tg-bg)':'transparent'};color:${view==='stats'?'var(--tg-text)':'var(--tg-hint)'}">Статистика</button>
      </div>
      ${view==='calendar' && html`<${MonthGrid} />`}
      ${view==='stats' && html`<${SymptomCorrelations} />`}
    </div>
  `;
}

function StepBrain({ value, onChange }) {
  const moods = [
    { k: 'euphoric', l: 'Эйфория', e: '🤩' }, { k: 'calm', l: 'Спокойствие', e: '😌' },
    { k: 'irritated', l: 'Раздражение', e: '😤' }, { k: 'sad', l: 'Грусть', e: '😢' },
    { k: 'anxious', l: 'Тревога', e: '😰' }, { k: 'numb', l: 'Апатия', e: '😶' },
  ];
  const slider = (label, key, max = 5) => html`
    <div class="s2">
      <div class="fx jcsb sm"><span class="txt">${label}</span><span class="med">${value[key]}/${max}</span></div>
      <input type="range" min="0" max=${max} step="1" value=${value[key]}
        onInput=${e => { tg?.HapticFeedback?.impactOccurred?.('light'); onChange({ [key]: +e.target.value }); }}
        class="w100" style="accent-color:var(--tg-button)" />
    </div>
  `;
  return html`
    <div class="px4 py6 s6">
      <h3 class="lg med tc txt">Мозг и энергия</h3>
      ${slider('Энергия', 'energyLevel')}
      ${slider('Фокус', 'focusLevel')}
      ${slider('Тревожность (кортизол)', 'anxietyLevel')}
      ${slider('Качество сна', 'sleepQuality')}
      <div class="s2">
        <span class="sm hint">Настроение</span>
        <div class="gr gr3 g2">
          ${moods.map(m => html`
            <button key=${m.k} onClick=${() => { tg?.HapticFeedback?.impactOccurred?.('medium'); onChange({ mood: m.k }); }}
              class="p3 r12 b2 tc tall"
              style="border-color:${value.mood===m.k?'var(--tg-button)':'var(--tg-secondary-bg)'};background:${value.mood===m.k?'var(--tg-secondary-bg)':'transparent'}">
              <div class="x2">${m.e}</div><div class="xs txt">${m.l}</div>
            </button>
          `)}
        </div>
      </div>
    </div>
  `;
}

function StepIntimacy({ value, libidoLevel, onChange, onLibidoChange }) {
  const labels = ['Спит','Тихо','Возможно','Желание','На пределе'];
  return html`
    <div class="px4 py6 s6">
      <h3 class="lg med tc txt">Интимность и тело</h3>
      <div>
        <label class="sm hint tc mb3 block">Уровень либидо</label>
        <div class="fx jcsb aie h24 g2">
          ${[0,1,2,3,4].map(lvl => html`
            <button key=${lvl} onClick=${() => { onLibidoChange(lvl); tg?.HapticFeedback?.impactOccurred?.('medium'); }}
              class="f1 r12 fx fxc jce pb2 tall"
              style="height:${40+lvl*18}%;background:${libidoLevel>=lvl?'rgba(244,63,94,0.15)':'var(--tg-secondary-bg)'};border:2px solid ${libidoLevel>=lvl?'rgba(244,63,94,0.3)':'transparent'}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color:${libidoLevel>=lvl?'#f43f5e':'var(--tg-hint)'}">
                <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" stroke="currentColor" stroke-width="1.5" fill=${libidoLevel>=lvl?'currentColor':'none'} />
              </svg>
            </button>
          `)}
        </div>
        <div class="tc sm hint mt2">${labels[libidoLevel]}</div>
      </div>
      <div class="s3">
        <label class="sm hint">Была интимность?</label>
        <div class="gr gr2 g3">
          ${[{k:'none',l:'Нет',i:'🌙'},{k:'solo',l:'Соло',i:'✨'},{k:'partner',l:'С партнёром',i:'🔮'}].map(opt => html`
            <button key=${opt.k} onClick=${() => { tg?.HapticFeedback?.impactOccurred?.('medium'); onChange({ ...value, occurred: opt.k !== 'none', type: opt.k }); }}
              class="p4 r12 b2 tc tall"
              style="border-color:${(opt.k==='none'&&!value.occurred)||(opt.k!=='none'&&value.occurred&&value.type===opt.k)?'rgba(244,63,94,0.4)':'var(--tg-secondary-bg)'};background:${(opt.k==='none'&&!value.occurred)||(opt.k!=='none'&&value.occurred&&value.type===opt.k)?'rgba(244,63,94,0.08)':'transparent'}">
              <div class="x2">${opt.i}</div><div class="sm med txt">${opt.l}</div>
            </button>
          `)}
        </div>
      </div>
      ${value.occurred && html`
        <div class="s4 anim">
          <button onClick=${() => { onChange({ ...value, orgasm: !value.orgasm }); if(!value.orgasm){tg?.HapticFeedback?.notificationOccurred?.('success');tg?.showAlert?.('Окситоциновый буст получен. Уровень кортизола программно снижен на 30% на ближайшие 12 часов.');} }}
            class="w100 p3 r12 b2 sm med tall"
            style="border-color:${value.orgasm?'rgba(245,158,11,0.5)':'var(--tg-secondary-bg)'};background:${value.orgasm?'rgba(245,158,11,0.08)':'transparent'}">
            ${value.orgasm ? '✓ Оргазм отмечен' : 'Отметить оргазм'}
          </button>
          <div class="gr gr2 g3">
            ${[{k:'protected',l:'С защитой'},{k:'unprotected',l:'Без защиты'}].map(p => html`
              <button key=${p.k} onClick=${() => onChange({ ...value, protection: p.k })}
                class="p3 r12 b2 sm"
                style="border-color:${value.protection===p.k?'rgba(139,92,246,0.5)':'var(--tg-secondary-bg)'};background:${value.protection===p.k?'rgba(139,92,246,0.08)':'transparent'}">${p.l}</button>
            `)}
          </div>
          <button onClick=${() => onChange({ ...value, discomfort: !value.discomfort })}
            class="w100 p3 r12 b2 sm"
            style="border-color:${value.discomfort?'rgba(249,115,22,0.5)':'var(--tg-secondary-bg)'};background:${value.discomfort?'rgba(249,115,22,0.08)':'transparent'}">
            ${value.discomfort ? '⚠ Дискомфорт отмечен' : 'Отметить дискомфорт'}
          </button>
        </div>
      `}
    </div>
  `;
}

function StepBody({ value, onChange }) {
  const symptoms = [
    { k: 'cramps', l: 'Спазмы', i: '⚡' }, { k: 'bloating', l: 'Вздутие', i: '🎈' },
    { k: 'headache', l: 'Головная боль', i: '🤕' }, { k: 'breast_tenderness', l: 'Чувствительность груди', i: '💗' },
    { k: 'acne', l: 'Высыпания', i: '🔴' }, { k: 'fatigue', l: 'Усталость', i: '😴' },
    { k: 'insomnia', l: 'Бессонница', i: '🌃' }, { k: 'cravings', l: 'Тяга к сладкому', i: '🍫' },
  ];
  const mucus = [
    { k: 'dry', l: 'Сухо', d: 'Нет выделений' }, { k: 'sticky', l: 'Липкие', d: 'Густые, белые' },
    { k: 'creamy', l: 'Кремовые', d: 'Молочные, влажные' }, { k: 'egg_white', l: 'Яичный белок', d: 'Прозрачные, тянущиеся' },
  ];
  const toggle = key => {
    tg?.HapticFeedback?.impactOccurred?.('light');
    const cur = value.symptoms || [];
    onChange({ symptoms: cur.includes(key) ? cur.filter(s => s !== key) : [...cur, key] });
  };
  return html`
    <div class="px4 py6 s6">
      <h3 class="lg med tc txt">Тело и симптомы</h3>
      <div class="fx jcsb aic r12 p4" style="background:var(--tg-secondary-bg)">
        <div>
          <div class="sm med txt">Менструация сегодня</div>
          <div class="xs hint">Отметь, если идут кровотечения</div>
        </div>
        <button onClick=${() => { tg?.HapticFeedback?.impactOccurred?.('medium'); onChange({ isPeriod: !value.isPeriod }); }}
          class="w12 h7 rf rel2" style="background:${value.isPeriod?'#EF4444':'var(--tg-hint)'}">
          <div class="abs w6 h6 bg-white rf shadow" style="top:2px;transition:transform 0.2s;transform:translateX(${value.isPeriod?20:2}px)" />
        </button>
      </div>
      <div class="s2">
        <label class="sm hint">Шейная слизь</label>
        <div class="gr gr2 g2">
          ${mucus.map(m => html`
            <button key=${m.k} onClick=${() => { tg?.HapticFeedback?.impactOccurred?.('light'); onChange({ cervicalMucus: m.k }); }}
              class="p3 r12 b2 tl tall"
              style="border-color:${value.cervicalMucus===m.k?'rgba(59,130,246,0.5)':'var(--tg-secondary-bg)'};background:${value.cervicalMucus===m.k?'rgba(59,130,246,0.08)':'transparent'}">
              <div class="sm med txt">${m.l}</div><div class="xs hint">${m.d}</div>
            </button>
          `)}
        </div>
      </div>
      <div class="s2">
        <label class="sm hint">Симптомы</label>
        <div class="gr gr2 g2">
          ${symptoms.map(s => {
            const a = value.symptoms?.includes(s.k);
            return html`
              <button key=${s.k} onClick=${() => toggle(s.k)}
                class="p3 r12 b2 tc tall"
                style="border-color:${a?'var(--tg-button)':'var(--tg-secondary-bg)'};background:${a?'var(--tg-secondary-bg)':'transparent'}">
                <div class="xl">${s.i}</div><div class="xs txt ${a?'med':''}">${s.l}</div>
              </button>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const defaultLog = {
  date: todayStr(), isPeriod: false, energyLevel: 3, focusLevel: 3, anxietyLevel: 2,
  mood: 'calm', libidoLevel: 2, intimacy: { occurred: false, type: 'none', protection: null, orgasm: false, discomfort: false },
  sleepQuality: 3, symptoms: [], cervicalMucus: 'dry',
};

function DailyCheckIn({ onClose }) {
  const [step, setStep] = useState('brain');
  const draft = store.getState().draftLog;
  const [log, setLog] = useState(() => draft && draft.date === todayStr() ? { ...defaultLog, ...draft } : { ...defaultLog });

  useEffect(() => { store.setDraftLog(log); }, [log]);

  const steps = [{ k: 'brain', l: 'Мозг' }, { k: 'intimacy', l: 'Интим' }, { k: 'body', l: 'Тело' }];
  const si = steps.findIndex(s => s.k === step);

  const next = () => {
    tg?.HapticFeedback?.impactOccurred?.('light');
    if (step === 'brain') setStep('intimacy');
    else if (step === 'intimacy') setStep('body');
    else { store.addLog({ ...defaultLog, ...log }); store.clearDraftLog(); tg?.HapticFeedback?.notificationOccurred?.('success'); onClose(); }
  };
  const back = () => {
    tg?.HapticFeedback?.impactOccurred?.('light');
    if (step === 'brain') {
      if (tg?.showConfirm) tg.showConfirm('Сохранить введённые данные?', ok => { if (!ok) store.clearDraftLog(); onClose(); });
      else onClose();
    } else if (step === 'intimacy') setStep('brain');
    else setStep('intimacy');
  };
  const upd = p => setLog(prev => ({ ...prev, ...p }));

  return html`
    <div class="fixed in0 z50 fx fxc" style="background:var(--tg-bg);color:var(--tg-text);animation:fadeIn .3s">
      <div class="fx jcsb aic px4 pt4 pb2 bt" style="border-color:var(--tg-secondary-bg)">
        <button onClick=${back} class="sm px2 py1" style="color:var(--tg-hint)">${step === 'brain' ? 'Отмена' : 'Назад'}</button>
        <div class="fx g1">
          ${steps.map((s, i) => html`<div key=${s.k} class="w8 h2 r8" style="background:${si >= i ? 'var(--tg-button)' : 'var(--tg-secondary-bg)'}" />`)}
        </div>
        <button onClick=${next} class="sm med px2 py1" style="color:var(--tg-button)">${step === 'body' ? 'Сохранить' : 'Далее'}</button>
      </div>
      <div class="f1 noscroll oh" style="overflow-y:auto">
        ${step === 'brain' && html`<${StepBrain} value=${{ energyLevel: log.energyLevel, focusLevel: log.focusLevel, anxietyLevel: log.anxietyLevel, mood: log.mood, sleepQuality: log.sleepQuality }} onChange=${v => upd(v)} />`}
        ${step === 'intimacy' && html`<${StepIntimacy} value=${log.intimacy} libidoLevel=${log.libidoLevel} onChange=${v => upd({ intimacy: v })} onLibidoChange=${v => upd({ libidoLevel: v })} />`}
        ${step === 'body' && html`<${StepBody} value=${{ isPeriod: log.isPeriod, symptoms: log.symptoms, cervicalMucus: log.cervicalMucus }} onChange=${v => upd(v)} />`}
      </div>
    </div>
  `;
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [lastPeriodStart, setLps] = useState(store.getState().lastPeriodStart);
  const [profile, setProfile] = useState(store.getState().currentProfile);

  useEffect(() => {
    store.subscribe(s => { setLps(s.lastPeriodStart); setProfile(s.currentProfile); });
    const uid = tg?.initDataUnsafe?.user?.id;
    if (uid) initStore(uid.toString());
  }, []);

  useEffect(() => {
    if (profile && tg) tg.MainButton.setParams({ color: NeuroEngine.getPhaseColor(profile.phase) });
  }, [profile]);

  const changeTab = t => { tg?.HapticFeedback?.impactOccurred?.('light'); setTab(t); };

  if (!lastPeriodStart) return html`<${Onboarding} />`;

  return html`
    <div style="background:var(--tg-bg);color:var(--tg-text)">
      ${tab==='dashboard' && html`<${NeuroDashboard} onCheckIn=${() => setCheckInOpen(true)} />`}
      ${tab==='planner' && html`<${NeuroPlanner} />`}
      ${tab==='calendar' && html`<${CalendarData} />`}
      ${checkInOpen && html`<${DailyCheckIn} onClose=${() => setCheckInOpen(false)} />`}
      <nav class="nav fx jcar aic">
        ${[{k:'dashboard',l:'Главная',i:'◉'},{k:'planner',l:'Планер',i:'☰'},{k:'calendar',l:'Календарь',i:'◎'}].map(t => html`
          <button key=${t.k} onClick=${() => changeTab(t.k)} class="fx fxc aic g1 px6 py1 r8 tall"
            style="color:${tab===t.k?'var(--tg-text)':'var(--tg-hint)'};font-weight:${tab===t.k?500:400}">
            <span class="lg">${t.i}</span><span class="x8">${t.l}</span>
          </button>
        `)}
      </nav>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
