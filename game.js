(() => {
'use strict';

// ---------- constants ----------
const CARD_W = 84, CARD_H = 114;
// Two table layouts: 'full' for desktop, 'compact' for phones in landscape
// (controls move to side columns and the table is squeezed so everything draws bigger).
// Positions of the felt, shoe, etc. are mirrored in style.css under body.compact.
const LAYOUTS = {
  full: {
    w: 1280, h: 820,
    shoe: { x: 1010, y: 120 }, discard: { x: 190, y: 120 }, tray: { x: 640, y: 108 }, dealerHand: { x: 640, y: 190 },
    betDy: 90, panelDy: 128, youPanelDy: 140, plateDy: 245, youPlateDy: 160,
    seats: { mia: [1060, 290], tony: [860, 350], you: [640, 385], vera: [420, 350], lou: [220, 290] },
  },
  compact: {
    w: 1280, h: 580,
    shoe: { x: 985, y: 80 }, discard: { x: 190, y: 80 }, tray: { x: 640, y: 76 }, dealerHand: { x: 640, y: 148 },
    betDy: 80, panelDy: 112, youPanelDy: 122, plateDy: 202, youPlateDy: 142,
    seats: { mia: [1040, 265], tony: [850, 300], you: [640, 322], vera: [430, 300], lou: [240, 265] },
  },
};
let L = LAYOUTS.full;
const SHOE = { ...L.shoe }, DISCARD = { ...L.discard }, TRAY = { ...L.tray }, DEALER_HAND = { ...L.dealerHand };
const BACK = 'assets/cards/cardBack_red2.png';
const SUITS = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DECKS = 6;
const MIN_BET = 5;
const START_BANKROLL = 1000;
const CHIPS = [
  { v: 5, img: 'chipWhite', light: true },
  { v: 10, img: 'chipBlue' },
  { v: 25, img: 'chipGreen' },
  { v: 100, img: 'chipBlackWhite' },
];
const MOOD_LIST = ['neutral', 'happy', 'ecstatic', 'sad', 'shocked', 'thinking', 'annoyed'];
const ADVICE = { hit: 'hit', stand: 'stand', double: 'double down', split: 'split' };

// Seats in play order (dealer's left = screen right goes first).
const SEAT_ORDER = ['mia', 'tony', 'you', 'vera', 'lou'];

const SFX = {
  slide: ['card-slide-1', 'card-slide-2'],
  place: ['card-place-1', 'card-place-2', 'card-place-3'],
  shuffle: ['card-shuffle'],
  fan: ['card-fan-1'],
  chip: ['chip-lay-1', 'chip-lay-2'],
  chips: ['chips-collide-1', 'chips-stack-1', 'chips-handle-1'],
};

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const stage = $('stage'), layer = $('layer');
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffled = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const realWait = ms => new Promise(r => setTimeout(r, ms));
const sleep = ms => realWait(ms * state.speed);
const div = (cls, parent) => { const d = document.createElement('div'); if (cls) d.className = cls; if (parent) parent.append(d); return d; };
const setPos = (el, x, y, rot = 0) => { el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`; };
const fmt = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const avatarSrc = (who, mood) => `assets/avatars/${who}_${mood}.svg`;
const cardSrc = c => `assets/cards/card${c.suit}${c.rank}.png`;

const state = {
  phase: 'idle', speed: 1, sound: true, lastBet: 0,
  seats: [], dealer: null, shoe: null, idleTimer: null, actionResolve: null, npcBetsDone: false,
};

// ---------- audio ----------
const audioCache = {};
function sfx(name, vol = 0.6) {
  if (!state.sound) return;
  const file = pick(SFX[name]);
  if (!audioCache[file]) audioCache[file] = new Audio(`assets/sfx/${file}.ogg`);
  const a = audioCache[file].cloneNode();
  a.volume = vol;
  a.play().catch(() => {});
}

// ---------- shoe & hands ----------
class Shoe {
  constructor(decks) {
    const cards = [];
    for (let d = 0; d < decks; d++)
      for (const suit of SUITS)
        for (const rank of RANKS)
          cards.push({ suit, rank, value: rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(rank) ? 10 : +rank });
    this.cards = shuffled(cards);
    this.cut = Math.floor(cards.length * 0.25);
  }
  draw() { return { ...this.cards.pop() }; }
  needsShuffle() { return this.cards.length < this.cut; }
}

const newHand = (owner, bet, fromSplit = false) =>
  ({ owner, bet, cards: [], fromSplit, done: false, settled: false, net: 0, badge: null, active: false, splitAces: false });

function handInfo(hand, onlyUp = false) {
  let total = 0, aces = 0;
  for (const c of hand.cards) {
    if (onlyUp && !c.faceUp) continue;
    total += c.value;
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}
const isBJ = h => !h.fromSplit && h.cards.length === 2 && handInfo(h).total === 21;
const dealerUp = () => state.dealer.hand.cards[0];

function basicStrategy(hand, up, canDouble, canSplit) {
  const u = up.value;
  const cards = hand.cards;
  if (canSplit && cards.length === 2 && cards[0].value === cards[1].value) {
    const v = cards[0].value;
    let split = false;
    if (v === 11 || v === 8) split = true;
    else if (v === 9) split = u <= 9 && u !== 7;
    else if (v === 7) split = u <= 7;
    else if (v === 6) split = u <= 6;
    else if (v === 4) split = u === 5 || u === 6;
    else if (v === 2 || v === 3) split = u <= 7;
    if (split) return 'split';
  }
  const { total: t, soft } = handInfo(hand);
  if (soft) {
    if (t >= 19) return 'stand';
    if (t === 18) { if (u >= 3 && u <= 6) return canDouble ? 'double' : 'stand'; return u <= 8 ? 'stand' : 'hit'; }
    if (t === 17) return u >= 3 && u <= 6 && canDouble ? 'double' : 'hit';
    if (t >= 15) return u >= 4 && u <= 6 && canDouble ? 'double' : 'hit';
    if (t >= 13) return u >= 5 && u <= 6 && canDouble ? 'double' : 'hit';
    return 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return u <= 6 ? 'stand' : 'hit';
  if (t === 12) return u >= 4 && u <= 6 ? 'stand' : 'hit';
  if (t === 11) return u <= 10 && canDouble ? 'double' : 'hit';
  if (t === 10) return u <= 9 && canDouble ? 'double' : 'hit';
  if (t === 9) return u >= 3 && u <= 6 && canDouble ? 'double' : 'hit';
  return 'hit';
}

// How each NPC personality plays. Returns { action, guessed }.
function npcDecide(style, hand, up, canD, canS) {
  const { total, soft } = handInfo(hand);
  const pair = canS ? hand.cards[0].value : 0;
  const book = basicStrategy(hand, up, canD, canS);
  switch (style) {
    case 'cautious':
      if (pair === 11 || pair === 8) return { action: 'split' };
      if (!soft && total === 11 && canD && up.value <= 10) return { action: 'double' };
      if (!soft && total >= 12) return { action: 'stand' };
      if (soft && total >= 18) return { action: 'stand' };
      return { action: 'hit' };
    case 'reckless':
      if (pair && pair !== 5 && (pair !== 10 || Math.random() < 0.3)) return { action: 'split' };
      if (!soft && total >= 9 && total <= 11 && canD) return { action: 'double' };
      if (soft) return { action: total >= 19 ? 'stand' : canD && Math.random() < 0.3 ? 'double' : 'hit' };
      return { action: total >= 18 ? 'stand' : 'hit' };
    case 'newbie':
      if ((book === 'double' || book === 'split') && Math.random() < 0.3) return { action: 'hit', guessed: true };
      if (Math.random() < 0.22) {
        if (book === 'stand' && total <= 16) return { action: 'hit', guessed: true };
        if (book === 'hit' && total >= 12) return { action: 'stand', guessed: true };
      }
      return { action: book };
    default:
      return { action: book };
  }
}

// ---------- seats & UI construction ----------
function buildSeat(key) {
  const isYou = key === 'you';
  const npc = isYou ? null : NPCS[key];
  const seat = {
    key, x: 0, y: 0, isYou, npc,
    name: isYou ? 'You' : npc.name,
    bankroll: isYou ? START_BANKROLL : npc.bankroll,
    bet: 0, hands: [], timers: {},
  };
  // bet circle
  seat.spot = div('betspot', layer);
  seat.stack = div('stack', seat.spot);
  seat.betLabel = div('betlabel', seat.spot);
  // player panel
  seat.panel = div('seat' + (isYou ? ' you' : ''), stage);
  seat.bubble = div('bubble', seat.panel);
  if (!isYou) {
    const av = div('avatar', seat.panel);
    seat.avatarImg = new Image();
    seat.avatarImg.src = avatarSrc(npc.avatar, 'neutral');
    av.append(seat.avatarImg);
    MOOD_LIST.forEach(m => { new Image().src = avatarSrc(npc.avatar, m); });
  }
  const plate = div('plate', seat.panel);
  div('nm', plate).textContent = seat.name;
  seat.bankLabel = div('bk', plate);
  placeSeat(seat);
  renderSeat(seat);
  return seat;
}

function placeSeat(seat) {
  [seat.x, seat.y] = L.seats[seat.key];
  seat.spot.style.left = seat.x + 'px';
  seat.spot.style.top = seat.y + L.betDy + 'px';
  seat.panel.style.left = seat.x + 'px';
  seat.panel.style.top = seat.y + (seat.isYou ? L.youPanelDy : L.panelDy) + 'px';
  seat.plateY = seat.y + (seat.isYou ? L.youPlateDy : L.plateDy);
}

function buildDealer() {
  const d = { key: 'dealer', npc: NPCS.dealer, timers: {}, hand: null };
  d.panel = div('seat dealer-seat', stage);
  d.bubble = div('bubble', d.panel);
  const av = div('avatar', d.panel);
  d.avatarImg = new Image();
  d.avatarImg.src = avatarSrc('dealer', 'neutral');
  av.append(d.avatarImg);
  MOOD_LIST.forEach(m => { new Image().src = avatarSrc('dealer', m); });
  return d;
}

function buildShoe() {
  const shoe = $('shoe');
  for (let i = 0; i < 4; i++) {
    const img = new Image(); img.src = BACK;
    img.style.left = i * 2 + 'px'; img.style.top = -i * 2 + 'px';
    shoe.append(img);
  }
}

function setDiscardPile(n) {
  const pile = $('discard');
  const want = Math.min(5, Math.ceil(n / 20));
  while (pile.children.length < want) {
    const img = new Image(); img.src = BACK;
    const i = pile.children.length;
    img.style.left = i * 1.5 + 'px'; img.style.top = -i * 2 + 'px';
    img.style.transform = `rotate(${rand(-4, 4)}deg)`;
    pile.append(img);
  }
  while (pile.children.length > want) pile.lastChild.remove();
}

function buildChipRack() {
  const rack = $('chip-rack');
  for (const c of CHIPS) {
    const b = document.createElement('button');
    b.className = 'chipbtn' + (c.light ? ' light' : '');
    b.style.backgroundImage = `url(assets/chips/${c.img}.png)`;
    b.textContent = c.v;
    b.dataset.v = c.v;
    b.onclick = () => addPlayerBet(c.v);
    rack.append(b);
  }
}

// ---------- rendering ----------
function chipBreakdown(amount) {
  const out = [];
  let left = Math.floor(amount);
  for (const c of [...CHIPS].reverse()) while (left >= c.v && out.length < 14) { out.push(c); left -= c.v; }
  return out;
}

function renderStack(el, amount) {
  el.innerHTML = '';
  chipBreakdown(amount).forEach((c, i) => {
    const img = new Image();
    img.src = `assets/chips/${c.img}_side.png`;
    img.style.top = (-4 - i * 5) + 'px';
    el.append(img);
  });
}

function seatBet(seat) {
  if (!seat.hands.length) return seat.bet;
  return seat.hands.reduce((s, h) => s + (h.settled ? 0 : h.bet), 0);
}

function renderSeat(seat) {
  const amt = seatBet(seat);
  renderStack(seat.stack, amt);
  seat.betLabel.textContent = amt ? fmt(amt) : '';
  seat.bankLabel.textContent = fmt(seat.bankroll);
  if (seat.isYou) updateUI();
  saveProgress();
}

// ---------- saving between visits ----------
// Bankrolls and settings live in localStorage. Chips placed but not dealt yet count as yours;
// once cards are dealt the bet is on the table, so leaving mid-hand forfeits it (like a real casino).
// Winnings count as soon as the hand is settled, even if the chip animation hasn't finished.
const SAVE_KEY = 'blackjack-save-v1';

function savedBankroll(seat) {
  return seat.bankroll + (seat.owed || 0) + (state.phase === 'betting' ? seat.bet : 0);
}

function saveProgress() {
  if (!state.loaded) return;
  const data = {
    bankrolls: Object.fromEntries(state.seats.map(s => [s.key, savedBankroll(s)])),
    lastBet: state.lastBet, sound: state.sound, fast: state.speed !== 1,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* private mode etc: just don't save */ }
}

function loadProgress() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* ignore corrupt or blocked storage */ }
  if (data && data.bankrolls) {
    for (const s of state.seats) {
      const b = data.bankrolls[s.key];
      if (typeof b === 'number' && isFinite(b) && b >= 0) s.bankroll = b;
    }
    state.lastBet = data.lastBet || 0;
    if (data.sound === false) { state.sound = false; $('btn-sound').textContent = 'Sound: Off'; }
    if (data.fast) setSpeed(true);
  }
  state.loaded = true;
  state.seats.forEach(renderSeat);
}

function layoutHand(hand, cx, cy, off) {
  const n = hand.cards.length;
  const left = cx - (CARD_W + (n - 1) * off) / 2;
  const top = cy - CARD_H / 2;
  hand.cards.forEach((c, j) => {
    c.el.style.zIndex = 10 + j;
    setPos(c.el, left + j * off, top - j * 3, c.rot);
  });
  if (hand.badge) setPos(hand.badge, left - 8, top - 28 - (n - 1) * 3);
}

function layoutOwner(owner) {
  if (owner === 'dealer') return layoutHand(state.dealer.hand, DEALER_HAND.x, DEALER_HAND.y, 30);
  const n = owner.hands.length;
  const spacing = n > 1 ? Math.max(120, ...owner.hands.map(h => CARD_W + (h.cards.length - 1) * 20 + 14)) : 0;
  owner.hands.forEach((h, i) => layoutHand(h, owner.x + (i - (n - 1) / 2) * spacing, owner.y, n > 1 ? 20 : 24));
}

function updateBadge(hand) {
  if (!hand.cards.some(c => c.faceUp)) return;
  if (!hand.badge) {
    hand.badge = div('badge', layer);
    layoutOwner(hand.owner);
  }
  const inf = handInfo(hand, true);
  let txt, cls = '';
  if (hand.cards.every(c => c.faceUp) && isBJ(hand)) { txt = 'Blackjack!'; cls = 'bj'; }
  else if (inf.bust) { txt = `${inf.total} BUST`; cls = 'bust'; }
  else txt = (inf.soft && inf.total < 21 ? 'soft ' : '') + inf.total;
  hand.badge.textContent = txt;
  hand.badge.className = 'badge ' + cls;
}

function setResultBadge(hand, text, cls) {
  if (!hand.badge) return;
  hand.badge.textContent = text;
  hand.badge.className = 'badge ' + cls;
}

function setActiveHand(hand, on) {
  hand.active = on;
  hand.cards.forEach(c => c.el.classList.toggle('active', on));
}

function setTurn(seat, on) {
  seat.panel.classList.toggle('turn', on);
  if (seat.spot) seat.spot.classList.toggle('active', on);
}

function showBanner(text, cls = '', ms = 2200) {
  const b = $('banner');
  b.textContent = text;
  b.className = 'show ' + cls;
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove('show'), ms);
}

function floatText(x, y, text, cls) {
  const f = div('floattext ' + cls, stage);
  f.style.left = x + 'px'; f.style.top = y + 'px';
  f.textContent = text;
  setTimeout(() => f.remove(), 1700);
}

async function flyChips(amount, from, to) {
  if (amount <= 0) return;
  const f = div('fly', stage);
  const st = div('stack', f);
  renderStack(st, amount);
  setPos(f, from.x, from.y);
  f.getBoundingClientRect();
  setPos(f, to.x, to.y);
  sfx('chips', 0.45);
  await realWait(560);
  f.remove();
}

const spotPos = s => ({ x: s.x, y: s.y + L.betDy });
const platePos = s => ({ x: s.x, y: s.plateY });

// ---------- talking & faces ----------
function setMood(who, mood, hold = 2600) {
  if (!who.avatarImg) return;
  const key = who.npc.avatar;
  who.avatarImg.src = avatarSrc(key, mood);
  clearTimeout(who.timers.mood);
  if (mood !== 'neutral') who.timers.mood = setTimeout(() => { who.avatarImg.src = avatarSrc(key, 'neutral'); }, hold);
  if (mood === 'ecstatic' || mood === 'happy') animate(who, 'bounce');
  if (mood === 'shocked' || mood === 'annoyed') animate(who, 'shake');
}

function animate(who, cls) {
  who.panel.classList.remove('bounce', 'shake');
  void who.panel.offsetWidth;
  who.panel.classList.add(cls);
  clearTimeout(who.timers.anim);
  who.timers.anim = setTimeout(() => who.panel.classList.remove(cls), 600);
}

function say(who, text, mood, ms = 2600, think = false) {
  const b = who.bubble;
  b.textContent = text;
  b.className = 'bubble show' + (think ? ' think' : '');
  clearTimeout(who.timers.bubble);
  who.timers.bubble = setTimeout(() => b.classList.remove('show'), ms);
  if (mood) setMood(who, mood, ms + 400);
}

function react(seat, event, vars = {}, mood) {
  if (!seat || !seat.npc) return false;
  const lines = seat.npc.lines[event];
  if (!lines) return false;
  const text = cap(pick(lines).replace('{advice}', vars.advice || ''));
  say(seat, text, mood || MOODS[event] || 'neutral');
  return true;
}

const npcSeats = () => state.seats.filter(s => !s.isYou);
const seatByKey = k => state.seats.find(s => s.key === k);

// A few NPCs (not all) chime in on something that happened.
function chatter(event, { exclude = null, max = 1, chance = 1, vars = {} } = {}) {
  let count = 0;
  for (const s of shuffled(npcSeats())) {
    if (s === exclude || !s.npc.lines[event]) continue;
    if (count >= max) break;
    if (Math.random() < s.npc.chatty * chance) {
      setTimeout(() => react(s, event, vars), count * 650 + rand(100, 350));
      count++;
    }
  }
}

function dealerSay(text, mood = 'neutral', ms = 2200) { say(state.dealer, text, mood, ms); }

function scheduleIdle() {
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (state.phase !== 'betting') return;
    react(pick(npcSeats()), 'idle');
    scheduleIdle();
  }, rand(6000, 11000));
}

// ---------- controls ----------
function showActions(mode, msg = '') {
  $('bet-actions').classList.toggle('hidden', mode !== 'bet');
  $('play-actions').classList.toggle('hidden', mode !== 'play');
  $('wait-msg').classList.toggle('hidden', mode !== 'wait');
  $('wait-msg').textContent = msg;
}

function you() { return seatByKey('you'); }

function updateUI() {
  const p = you();
  if (!p) return;
  $('ui-bankroll').textContent = fmt(p.bankroll);
  $('ui-bet').textContent = fmt(seatBet(p));
  const betting = state.phase === 'betting';
  document.querySelectorAll('.chipbtn').forEach(b => { b.disabled = !betting || +b.dataset.v > p.bankroll; });
  $('btn-deal').disabled = !betting || p.bet < MIN_BET || !state.npcBetsDone;
  $('btn-clear').disabled = !betting || p.bet === 0;
  $('btn-rebet').disabled = !betting || !state.lastBet || state.lastBet > p.bankroll + p.bet || p.bet === state.lastBet;
  const broke = betting && p.bankroll + p.bet < MIN_BET;
  $('btn-rebet').textContent = broke ? `Rebuy ${fmt(START_BANKROLL)}` : 'Rebet';
  if (broke) $('btn-rebet').disabled = false;
}

function addPlayerBet(v) {
  const p = you();
  if (state.phase !== 'betting' || v > p.bankroll) return;
  p.bankroll -= v; p.bet += v;
  sfx('chip', 0.6);
  renderSeat(p);
}

function clearPlayerBet() {
  const p = you();
  if (state.phase !== 'betting') return;
  p.bankroll += p.bet; p.bet = 0;
  renderSeat(p);
}

function rebet() {
  const p = you();
  if (p.bankroll + p.bet < MIN_BET) {
    p.bankroll += START_BANKROLL;
    say(seatByKey('lou'), 'Back again, kid? Atta boy.', 'happy');
    renderSeat(p);
    return;
  }
  clearPlayerBet();
  if (state.lastBet <= p.bankroll) { p.bankroll -= state.lastBet; p.bet = state.lastBet; sfx('chips', 0.5); }
  renderSeat(p);
}

function setPlayButtons(hand, seat) {
  const canD = hand.cards.length === 2 && seat.bankroll >= hand.bet;
  const canS = hand.cards.length === 2 && hand.cards[0].value === hand.cards[1].value && seat.hands.length < 4 && seat.bankroll >= hand.bet;
  $('btn-double').disabled = !canD;
  $('btn-split').disabled = !canS;
  $('btn-hit').disabled = false;
  $('btn-stand').disabled = false;
  $('btn-ask').disabled = !seatByKey('lou');
  return { canD, canS };
}

function resolveAction(a) {
  if (state.phase !== 'player' || !state.actionResolve) return;
  const btn = $('btn-' + a);
  if (btn && btn.disabled) return;
  const r = state.actionResolve;
  state.actionResolve = null;
  r(a);
}

// ---------- dealing ----------
async function flip(card) {
  card.el.classList.add('flip');
  await realWait(130);
  card.img.src = cardSrc(card);
  card.faceUp = true;
  card.el.classList.remove('flip');
  sfx('place', 0.5);
  await realWait(130);
}

async function dealCard(hand, faceUp = true) {
  const c = state.shoe.draw();
  c.rot = rand(-3, 3);
  c.faceUp = false;
  c.el = div('card', layer);
  c.img = new Image();
  c.img.src = BACK;
  c.img.draggable = false;
  c.el.append(c.img);
  setPos(c.el, SHOE.x, SHOE.y, -12);
  c.el.getBoundingClientRect();
  hand.cards.push(c);
  if (hand.active) c.el.classList.add('active');
  layoutOwner(hand.owner);
  sfx('slide', 0.5);
  await sleep(230);
  if (faceUp) await flip(c);
  updateBadge(hand);
  await sleep(150);
  return c;
}

async function revealHole() {
  const hole = state.dealer.hand.cards[1];
  if (hole && !hole.faceUp) { await flip(hole); updateBadge(state.dealer.hand); await sleep(350); }
}

async function clearTable() {
  const els = [...layer.querySelectorAll('.card, .badge')];
  if (!els.length) return;
  sfx('fan', 0.4);
  els.forEach((el, i) => {
    if (el.classList.contains('badge')) { el.style.opacity = 0; return; }
    el.style.zIndex = 50 + i;
    setPos(el, DISCARD.x + rand(-3, 3), DISCARD.y + rand(-3, 3), 10 + rand(-6, 6));
    const img = el.querySelector('img');
    setTimeout(() => { img.src = BACK; }, 150);
  });
  await sleep(450);
  els.forEach(el => el.remove());
  state.discarded = (state.discarded || 0) + els.length;
  setDiscardPile(state.discarded);
  for (const s of state.seats) { s.hands = []; s.bet = 0; renderSeat(s); }
  state.dealer.hand = null;
}

async function shuffleShoe() {
  dealerSay(pick(NPCS.dealer.lines.shuffle));
  chatter('shuffle', { chance: 0.6 });
  sfx('shuffle', 0.6);
  $('shoe').animate([{ transform: 'rotate(-12deg)' }, { transform: 'rotate(-8deg) translateY(-6px)' }, { transform: 'rotate(-12deg)' }], { duration: 400, iterations: 3 });
  await sleep(1300);
  state.shoe = new Shoe(DECKS);
  state.discarded = 0;
  setDiscardPile(0);
}

// ---------- round flow ----------
async function startBetting() {
  state.phase = 'clearing';
  showActions('wait', '');
  await clearTable();
  if (state.shoe.needsShuffle()) await shuffleShoe();

  // NPCs who went broke buy back in
  for (const s of npcSeats()) {
    if (s.bankroll < Math.min(...s.npc.bets)) {
      s.bankroll += s.npc.bankroll;
      react(s, 'broke');
      renderSeat(s);
    }
  }

  state.phase = 'betting';
  state.npcBetsDone = false;
  showActions('bet');
  dealerSay(pick(NPCS.dealer.lines.bets));
  updateUI();

  let talkers = 0;
  for (const s of npcSeats()) {
    await sleep(rand(250, 550));
    const amt = Math.min(pick(s.npc.bets), s.bankroll);
    s.bankroll -= amt; s.bet = amt;
    sfx('chip', 0.5);
    renderSeat(s);
    if (talkers < 1 && Math.random() < 0.3) { talkers++; react(s, 'bet'); }
  }
  state.npcBetsDone = true;
  updateUI();
  scheduleIdle();
}

async function playRound() {
  const p = you();
  if (state.phase !== 'betting' || p.bet < MIN_BET || !state.npcBetsDone) return;
  state.phase = 'dealing';
  clearTimeout(state.idleTimer);
  state.lastBet = p.bet;
  showActions('wait', 'Dealing...');
  updateUI();
  saveProgress();

  const active = state.seats.filter(s => s.bet > 0);
  active.forEach(s => { s.hands = [newHand(s, s.bet)]; });
  state.dealer.hand = newHand('dealer', 0);

  for (let r = 0; r < 2; r++) {
    for (const s of active) await dealCard(s.hands[0]);
    await dealCard(state.dealer.hand, r === 0);
  }

  // first impressions
  const up = dealerUp();
  let talkers = 0;
  for (const s of active) {
    const h = s.hands[0], inf = handInfo(h);
    if (s.isYou) {
      if (isBJ(h)) { showBanner('Blackjack!', 'win'); chatter('player_bj', { max: 2 }); talkers += 2; }
      continue;
    }
    if (isBJ(h)) { react(s, 'dealt_bj'); talkers++; }
    else if (talkers < 2 && inf.total >= 19 && Math.random() < 0.5) { react(s, 'dealt_good'); talkers++; }
    else if (talkers < 2 && !inf.soft && inf.total >= 12 && inf.total <= 16 && up.value >= 7 && Math.random() < 0.5) { react(s, 'dealt_bad'); talkers++; }
  }
  await sleep(700);

  // dealer peeks with an ace or ten showing
  if (up.value >= 10) {
    dealerSay('Checking for blackjack...', 'thinking', 1200);
    await sleep(1200);
    if (isBJ(state.dealer.hand)) {
      await revealHole();
      dealerSay(pick(NPCS.dealer.lines.bj), 'happy');
      chatter('dealer_bj', { max: 2 });
      await settleAll();
      return finishRound();
    }
    dealerSay('No blackjack.');
    await sleep(500);
  }

  // blackjacks get paid right away
  const bjPays = [];
  for (const s of active) {
    const h = s.hands[0];
    if (isBJ(h)) { h.done = true; bjPays.push(settleHand(s, h, 'bj', bjPays.length * 150)); }
  }
  if (bjPays.length) await Promise.all(bjPays);

  for (const s of active) await playSeat(s);
  await dealerPlay();
  await settleAll();
  finishRound();
}

async function playSeat(seat) {
  if (seat.hands.every(h => h.done)) return;
  setTurn(seat, true);
  if (!seat.isYou) showActions('wait', `${seat.name} is playing...`);
  for (let i = 0; i < seat.hands.length; i++) {
    const h = seat.hands[i];
    if (h.done) continue;
    if (seat.hands.length > 1 || seat.isYou) setActiveHand(h, true);
    if (h.cards.length === 1) await dealCard(h);
    while (!h.done) {
      const inf = handInfo(h);
      if (inf.total >= 21 || (h.splitAces && h.cards.length >= 2)) { h.done = true; break; }
      const action = seat.isYou ? await playerAction(seat, h) : await npcAction(seat, h);
      await doAction(seat, h, action);
    }
    setActiveHand(h, false);
  }
  setTurn(seat, false);
  await sleep(250);
}

async function npcAction(seat, hand) {
  say(seat, '...', 'thinking', 900, true);
  await sleep(rand(700, 1300));
  const up = dealerUp();
  const canD = hand.cards.length === 2 && seat.bankroll >= hand.bet;
  const canS = hand.cards.length === 2 && hand.cards[0].value === hand.cards[1].value && seat.hands.length < 4 && seat.bankroll >= hand.bet;
  const { action, guessed } = npcDecide(seat.npc.style, hand, up, canD, canS);
  if (guessed && Math.random() < 0.6) react(seat, 'guess');
  else if (action === 'split' && hand.cards[0].value === 10 && react(seat, 'split_tens')) {
    setTimeout(() => react(seatByKey('lou'), 'player_bad', { advice: 'stand' }, 'annoyed'), 1200);
  }
  else if (action === 'double' || action === 'split' || Math.random() < 0.45 * seat.npc.chatty) react(seat, action);
  else seat.bubble.classList.remove('show');
  maybeStiffComplaint(seat, hand, action);
  return action;
}

function maybeStiffComplaint(seat, hand, action) {
  const vera = seatByKey('vera');
  if (!vera || seat === vera || action !== 'hit') return;
  const inf = handInfo(hand);
  if (!inf.soft && inf.total >= 12 && inf.total <= 16 && dealerUp().value <= 6 && Math.random() < 0.5)
    setTimeout(() => react(vera, 'stiff_hit'), 900);
}

async function playerAction(seat, hand) {
  state.phase = 'player';
  showActions('play');
  const { canD, canS } = setPlayButtons(hand, seat);
  const action = await new Promise(r => { state.actionResolve = r; });
  state.phase = 'playing';
  showActions('wait', '');

  // the table has opinions
  const up = dealerUp();
  const book = basicStrategy(hand, up, canD, canS);
  const inf = handInfo(hand);
  const lou = seatByKey('lou');
  if (action !== book) {
    if (lou && Math.random() < 0.6) setTimeout(() => react(lou, 'player_bad', { advice: ADVICE[book] }), 900);
    else if (Math.random() < 0.4) setTimeout(() => react(seatByKey('mia'), 'player_bad'), 900);
    if (action === 'hit' && !inf.soft && inf.total >= 15) setTimeout(() => react(seatByKey('tony'), 'player_risky'), 1800);
  } else if ((action === 'double' || action === 'split') && lou && Math.random() < 0.5) {
    setTimeout(() => react(lou, 'player_good'), 900);
  }
  if (action === 'double') chatter('player_double', { exclude: lou, chance: 0.7 });
  maybeStiffComplaint(seat, hand, action);
  return action;
}

async function doAction(seat, hand, action) {
  if (action === 'stand') { hand.done = true; return; }

  if (action === 'double') {
    seat.bankroll -= hand.bet;
    hand.bet *= 2;
    sfx('chips', 0.6);
    renderSeat(seat);
    await sleep(300);
    const c = await dealCard(hand);
    c.rot = 90; layoutOwner(seat);
    hand.done = true;
  } else if (action === 'split') {
    seat.bankroll -= hand.bet;
    const moved = hand.cards.pop();
    const nh = newHand(seat, hand.bet, true);
    hand.fromSplit = true;
    nh.cards.push(moved);
    if (moved.rank === 'A') hand.splitAces = nh.splitAces = true;
    seat.hands.splice(seat.hands.indexOf(hand) + 1, 0, nh);
    moved.el.classList.remove('active');
    updateBadge(hand); updateBadge(nh);
    layoutOwner(seat);
    sfx('chips', 0.6);
    renderSeat(seat);
    await sleep(450);
    await dealCard(hand);
  } else {
    await dealCard(hand);
  }

  const inf = handInfo(hand);
  if (inf.bust) {
    hand.done = true;
    if (seat.isYou) { showBanner('Bust!', 'lose', 1500); chatter('player_bust', { max: 1 }); }
    else react(seat, 'bust');
    await sleep(400);
    await settleHand(seat, hand, 'lose');
  } else if (inf.total === 21) {
    hand.done = true;
    if (!seat.isYou && Math.random() < 0.7) react(seat, 'got21');
  }
}

async function dealerPlay() {
  const d = state.dealer.hand;
  setTurn(state.dealer, true);
  showActions('wait', "Dealer's turn");
  await revealHole();
  const live = state.seats.some(s => s.hands.some(h => !h.settled));
  if (live) {
    while (handInfo(d).total < 17) {
      await sleep(450);
      await dealCard(d);
    }
  }
  const inf = handInfo(d);
  if (inf.bust) {
    dealerSay(pick(NPCS.dealer.lines.bust), 'happy');
    chatter('dealer_bust', { max: 3, chance: 1.2 });
    sfx('chips', 0.5);
  } else if (live) {
    dealerSay(`Dealer has ${inf.total}.`);
  }
  setTurn(state.dealer, false);
  await sleep(600);
}

function outcome(hand) {
  const d = state.dealer.hand;
  const dBJ = isBJ(d), pBJ = isBJ(hand);
  if (dBJ && pBJ) return 'push';
  if (dBJ) return 'lose';
  if (pBJ) return 'bj';
  const pt = handInfo(hand).total, dt = handInfo(d).total;
  if (pt > 21) return 'lose';
  if (dt > 21 || pt > dt) return 'win';
  if (pt < dt) return 'lose';
  return 'push';
}

async function settleHand(seat, hand, result, delay = 0) {
  if (hand.settled) return;
  await realWait(delay);
  const spot = spotPos(seat), plate = platePos(seat);
  if (result === 'lose') {
    hand.settled = true; hand.net = -hand.bet; hand.result = 'lose';
    if (!handInfo(hand).bust) setResultBadge(hand, `Lose -${fmt(hand.bet)}`, 'lose');
    renderSeat(seat);
    floatText(spot.x, spot.y - 30, '-' + fmt(hand.bet), 'neg');
    await flyChips(hand.bet, spot, TRAY);
    return;
  }
  if (result === 'push') {
    seat.owed = (seat.owed || 0) + hand.bet;
    hand.settled = true; hand.net = 0; hand.result = 'push';
    setResultBadge(hand, 'Push', 'push');
    renderSeat(seat);
    await flyChips(hand.bet, spot, plate);
    seat.bankroll += hand.bet;
    seat.owed -= hand.bet;
    renderSeat(seat);
    return;
  }
  const pay = result === 'bj' ? hand.bet * 1.5 : hand.bet;
  hand.net = pay; hand.result = result;
  seat.owed = (seat.owed || 0) + hand.bet + pay;
  saveProgress();
  setResultBadge(hand, (result === 'bj' ? 'Blackjack +' : 'Win +') + fmt(pay), result === 'bj' ? 'bj' : 'win');
  floatText(spot.x, spot.y - 30, '+' + fmt(pay), 'pos');
  await flyChips(pay, TRAY, spot);
  hand.settled = true;
  renderSeat(seat);
  await flyChips(hand.bet + pay, spot, plate);
  seat.bankroll += hand.bet + pay;
  seat.owed -= hand.bet + pay;
  renderSeat(seat);
}

async function settleAll() {
  const jobs = [];
  let i = 0;
  for (const s of state.seats)
    for (const h of s.hands)
      if (!h.settled) jobs.push(settleHand(s, h, outcome(h), i++ * 160));
  await Promise.all(jobs);

  // round summary reactions
  let talkers = 0;
  for (const s of shuffled(state.seats)) {
    if (!s.hands.length) continue;
    const net = s.hands.reduce((a, h) => a + h.net, 0);
    if (s.isYou) {
      if (net > 0) showBanner(`You win ${fmt(net)}!`, 'win');
      else if (net < 0) showBanner(`You lose ${fmt(-net)}`, 'lose');
      else showBanner('Push', '');
      continue;
    }
    // the person who just busted already reacted
    if (s.hands.every(h => handInfo(h).bust)) { setMood(s, 'sad', 2500); continue; }
    const ev = s.hands.some(h => h.result === 'bj') ? 'bj_win' : net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
    if (talkers < 2 && Math.random() < s.npc.chatty) {
      setTimeout(() => react(s, ev), talkers * 700 + 300);
      talkers++;
    } else setMood(s, MOODS[ev], 2500);
  }
}

async function finishRound() {
  state.phase = 'done';
  showActions('wait', '');
  await sleep(2600);
  startBetting();
}

// ---------- setup ----------
function applyLayout(name) {
  if (L === LAYOUTS[name] && stage.style.width) return;
  L = LAYOUTS[name];
  document.body.classList.toggle('compact', name === 'compact');
  stage.style.width = L.w + 'px';
  stage.style.height = L.h + 'px';
  Object.assign(SHOE, L.shoe); Object.assign(DISCARD, L.discard);
  Object.assign(TRAY, L.tray); Object.assign(DEALER_HAND, L.dealerHand);
  for (const s of state.seats) { placeSeat(s); if (s.hands.length) layoutOwner(s); }
  if (state.dealer && state.dealer.hand) layoutOwner('dealer');
}

function fit() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth, h = vv ? vv.height : window.innerHeight;
  applyLayout(isTouch && w > h ? 'compact' : 'full');
  const s = Math.min(w / L.w, h / L.h);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}

// ---------- mobile: fullscreen, landscape, and not leaving by accident ----------
const isTouch = matchMedia('(pointer: coarse)').matches;
const root = document.documentElement;
const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isInstalledApp = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;

async function enterFullscreen() {
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen();
  } catch (e) { /* refused: the game still works windowed */ }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* unsupported: the rotate overlay covers it */ }
}

function setupFullscreen() {
  if (!isTouch || isInstalledApp) return;
  const prompt = $('fs-prompt');
  if (canFullscreen) {
    $('btn-go-fs').onclick = () => { prompt.classList.add('hidden'); enterFullscreen(); };
    $('btn-fullscreen').onclick = enterFullscreen;
    $('btn-fullscreen').classList.remove('hidden');
  } else {
    // iPhone Safari has no fullscreen API; adding to the home screen is the way to get it
    $('btn-go-fs').textContent = 'Play';
    $('btn-skip-fs').classList.add('hidden');
    $('ios-tip').classList.remove('hidden');
    $('btn-go-fs').onclick = () => prompt.classList.add('hidden');
  }
  $('btn-skip-fs').onclick = () => prompt.classList.add('hidden');
  prompt.classList.remove('hidden');
  const onChange = () => { $('btn-fullscreen').classList.toggle('hidden', isFullscreen()); setTimeout(fit, 150); };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
}

function setupLeaveGuard() {
  // An extra history entry catches the back button / back swipe so we can ask first.
  // Browsers ignore entries pushed before the user interacts, so arm it on the first tap or key.
  const arm = () => {
    history.pushState({ table: true }, '');
    ['click', 'keydown', 'touchend'].forEach(ev => document.removeEventListener(ev, arm, true));
  };
  ['click', 'keydown', 'touchend'].forEach(ev => document.addEventListener(ev, arm, true));
  window.addEventListener('popstate', () => {
    if (state.leaving) return;
    history.pushState({ table: true }, '');
    $('leave-prompt').classList.remove('hidden');
  });
  $('btn-stay').onclick = () => $('leave-prompt').classList.add('hidden');
  $('btn-leave').onclick = () => { state.leaving = true; history.go(-2); };
  // refresh / closing the tab / typing a new address
  window.addEventListener('beforeunload', e => {
    if (state.leaving) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function setSpeed(fast) {
  state.speed = fast ? 0.5 : 1;
  document.documentElement.style.setProperty('--t', fast ? '.22s' : '.38s');
  $('btn-fast').textContent = 'Speed: ' + (fast ? 'Fast' : 'Normal');
  saveProgress();
}

function init() {
  buildShoe();
  buildChipRack();
  state.dealer = buildDealer();
  state.seats = SEAT_ORDER.map(buildSeat);
  state.shoe = new Shoe(DECKS);
  loadProgress();

  $('btn-deal').onclick = playRound;
  $('btn-clear').onclick = clearPlayerBet;
  $('btn-rebet').onclick = rebet;
  ['hit', 'stand', 'double', 'split'].forEach(a => { $('btn-' + a).onclick = () => resolveAction(a); });
  $('btn-ask').onclick = () => {
    const p = you(), h = p.hands.find(x => x.active);
    if (!h || state.phase !== 'player') return;
    const { canD, canS } = setPlayButtons(h, p);
    react(seatByKey('lou'), 'advise', { advice: ADVICE[basicStrategy(h, dealerUp(), canD, canS)] });
  };
  $('btn-sound').onclick = () => { state.sound = !state.sound; $('btn-sound').textContent = 'Sound: ' + (state.sound ? 'On' : 'Off'); saveProgress(); };
  $('btn-fast').onclick = () => setSpeed(state.speed === 1);

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (state.phase === 'player') {
      const map = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
      if (map[k]) resolveAction(map[k]);
    } else if (state.phase === 'betting' && (k === 'enter' || k === ' ')) {
      e.preventDefault();
      playRound();
    }
  });

  if (location.search.includes('debug')) window.__bj = state;
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  setupFullscreen();
  setupLeaveGuard();
  fit();
  startBetting();
}

init();
})();
