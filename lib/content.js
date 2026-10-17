/* ============================================================
   qeep revival - static content: avatars, titles, badges,
   shop, chat rooms, quiz bank, emoticons
   ============================================================ */

const AVATAR_CHARS = ['☺','☻','♥','★','◆','●','▲','♣','♠','♦','■','□','◇','○','△','▽','✦','✧','☀','☁','☂','☾','✿','❄'];
const AVATAR_COLORS = ['#a6ff2e','#4fd1ff','#ff5d5d','#ffcf3f','#c08bff','#ff9f3f','#4fffb0','#ff7bd1','#7bd88f','#66d9ef','#e08bff','#ffb84f'];

const AVATARS = AVATAR_CHARS.map((ch, i) => ({ id: i + 1, ch, c: AVATAR_COLORS[i % AVATAR_COLORS.length] }));

const TITLES = [
  { id: 'rookie',    name: 'Rookie',          cost: 0 },
  { id: 'knight',    name: 'Nokia Knight',    cost: 150 },
  { id: 'snake',     name: 'Snake Champion',  cost: 300 },
  { id: 'gprs',      name: 'GPRS Guru',       cost: 400 },
  { id: 'mms',       name: 'MMS Maestro',     cost: 500 },
  { id: 'veteran',   name: 'Qeep Veteran',    cost: 800 },
  { id: 'legend',    name: 'Pixel Legend',    cost: 1200 },
  { id: 'immortal',  name: 'Retro Immortal',  cost: 2500 },
];

const BADGES = [
  { id: 'first_win',  icon: '★', name: 'First Blood',   desc: 'Win your first game',        coins: 25 },
  { id: 'wins_10',    icon: '✔', name: 'Winner',        desc: 'Win 10 games',               coins: 100 },
  { id: 'wins_50',    icon: '♛', name: 'Champion',      desc: 'Win 50 games',               coins: 300 },
  { id: 'gamer',      icon: '▦', name: 'Gamer',         desc: 'Play 10 games',              coins: 60 },
  { id: 'allrounder', icon: '✦', name: 'All-Rounder',   desc: 'Win in 3 different games',   coins: 150 },
  { id: 'rich',       icon: '◆', name: 'Coin Hoarder',  desc: 'Hold 1000 coins',            coins: 50 },
  { id: 'social',     icon: '☺', name: 'Socialite',     desc: 'Make 5 friends',             coins: 75 },
  { id: 'chatter',    icon: '✉', name: 'Chatterbox',    desc: 'Send 50 chat messages',      coins: 50 },
  { id: 'shopper',    icon: '⚑', name: 'Big Spender',   desc: 'Buy 3 things from the shop', coins: 50 },
  { id: 'level5',     icon: '▲', name: 'Rising Star',   desc: 'Reach level 5',              coins: 100 },
  { id: 'level10',    icon: '✧', name: 'Superstar',     desc: 'Reach level 10',             coins: 250 },
  { id: 'streak7',    icon: '☀', name: 'Regular',       desc: 'Daily bonus 7 days running', coins: 200 },
];

/* Default avatars everyone owns (the first 8) */
const FREE_AVATARS = AVATARS.slice(0, 8).map((a) => 'av' + a.id);

const SHOP = [
  ...AVATARS.slice(8).map((a) => ({ id: 'av' + a.id, type: 'avatar', icon: a.ch, color: a.c, name: 'Avatar #' + a.id, cost: 60 + a.id * 15 })),
  ...TITLES.filter((t) => t.cost > 0).map((t) => ({ id: 'title_' + t.id, type: 'title', icon: '⚑', name: t.name, cost: t.cost, titleId: t.id })),
];

/* XP needed to reach a level (cumulative, quadratic-ish) */
function xpForLevel(level) { return Math.round(50 * level * (level - 1) / 2 + (level - 1) * 30); }
function levelFromXp(xp) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

const ROOMS = {
  lobby:   { id: 'lobby',   name: 'The Lobby',    topic: 'Say hi to everyone' },
  sayhi:   { id: 'sayhi',   name: 'Say Hi',       topic: 'New here? Introduce yourself' },
  gamers:  { id: 'gamers',  name: 'Game Central', topic: 'Talk games + find opponents' },
  retro:   { id: 'retro',   name: 'Retro Corner', topic: 'Nokia, Snake, and the old days' },
  helpline:{ id: 'helpline',name: 'Help Desk',    topic: 'Stuck? Ask here' },
};

const EMOTICONS = {
  ':)': '☺', ':-)': '☺', ':D': '☻', '<3': '♥', ':(': '☹', ';)': '★', ':*': '✿', ':P': '◆', 'o/': '▲', '\\\\o': '▲', '(y)': '▲', ':*(': '☂',
};

const QUIZ = [
  { q: 'What does "J2ME" stand for?', o: ['Java 2 Micro Edition', 'Just 2 Mobile Emails', 'Java Mobile Engine', 'Joint 2 Mega Empire'], a: 0 },
  { q: 'Which company made the Snake game on Nokia phones?', o: ['Nokia', 'Sega', 'Taneli Armanto', 'Ericsson'], a: 2 },
  { q: 'What does GPRS stand for?', o: ['General Packet Radio Service', 'Global Phone Routing System', 'Great Personal Ringtone Set', 'GSM Packet Relay Switch'], a: 0 },
  { q: 'Which year did the first iPhone launch?', o: ['2005', '2007', '2009', '2010'], a: 1 },
  { q: 'What resolution did many early Nokia colour screens have?', o: ['128x128', '240x320', '320x480', '640x480'], a: 0 },
  { q: 'Which of these was NOT a mobile OS?', o: ['Symbian', 'Bada', 'NgageOS', 'MeeGo'], a: 2 },
  { q: 'What does SMS stand for?', o: ['Short Message Service', 'Simple Mobile Signal', 'Smart Messaging System', 'Standard Media Sync'], a: 0 },
  { q: 'How many pixels wide was a classic Nokia 3310 screen?', o: ['84', '128', '96', '64'], a: 0 },
  { q: 'Which protocol did WAP phones use to browse?', o: ['WAP', 'HTTP/3', 'FTP', 'SMTP'], a: 0 },
  { q: 'The Nokia tune is based on which composer piece?', o: ['Gran Vals', 'Fur Elise', 'Clair de Lune', 'Bolero'], a: 0 },
  { q: 'What did "MMS" let you send that SMS could not?', o: ['Pictures and sounds', 'Longer numbers', 'Faster text', 'Group calls'], a: 0 },
  { q: 'Which key did you press to lock a Nokia keypad?', o: ['* then lock', 'Menu twice', '# and *', '0 and #'], a: 0 },
  { q: 'Snake II added what feature?', o: ['Mazes and obstacles', 'Online play', 'Colour graphics', 'Two players'], a: 0 },
  { q: 'What is a "MIDlet"?', o: ['A Java ME application', 'A tiny phone', 'A text message', 'A ringtone format'], a: 0 },
  { q: 'Which year did qeep roughly launch?', o: ['2007', '2003', '2011', '2014'], a: 0 },
];

module.exports = {
  AVATARS, AVATAR_COLORS, TITLES, BADGES, SHOP, FREE_AVATARS, ROOMS, EMOTICONS, QUIZ,
  xpForLevel, levelFromXp,
};
