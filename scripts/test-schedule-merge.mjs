import assert from 'node:assert/strict'

const DAY_ORDER = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']

function normalizeDay(value){
  const r=String(value??'').trim().toLowerCase().replace(/ё/g,'е')
  const a={пн:'Понедельник',пон:'Понедельник',понедельник:'Понедельник',вт:'Вторник',вторник:'Вторник',ср:'Среда',среда:'Среда',чт:'Четверг',четверг:'Четверг',пт:'Пятница',пятница:'Пятница',сб:'Суббота',суббота:'Суббота',вс:'Воскресенье',воскресенье:'Воскресенье'}
  return a[r]||String(value??'').trim()||'Понедельник'
}
function normalizeLessons(raw){
  if(!Array.isArray(raw)) return []
  const out=[]
  raw.forEach((x,i)=>{
    if(!x||typeof x!=='object') return
    const subject=String(x.subject??x.name??x.title??'').trim()
    if(!subject) return
    const n=Number(x.lesson??x.number??i+1)
    out.push({day:normalizeDay(x.day),lesson:Number.isFinite(n)&&n>0?Math.floor(n):i+1,subject,time:String(x.time??'').trim(),room:String(x.room??x.cabinet??x.classroom??'').trim()})
  })
  out.sort((a,b)=>(DAY_ORDER.indexOf(a.day)-DAY_ORDER.indexOf(b.day))||a.lesson-b.lesson||a.subject.localeCompare(b.subject,'ru'))
  const seen=new Set()
  return out.filter(x=>{const k=[x.day,x.lesson,x.subject,x.time,x.room].join('|');if(seen.has(k))return false;seen.add(k);return true})
}

// Та же логика, что и в readAdminPhoto() в index.html: дни, распознанные на новом
// фото, полностью заменяют старые записи на эти дни; остальные дни сохраняются.
function mergeByDay(oldLessonsRaw, newLessonsRaw){
  const newLessons = normalizeLessons(newLessonsRaw)
  const newDays = new Set(newLessons.map(x => x.day))
  const oldLessons = normalizeLessons(oldLessonsRaw)
  const kept = oldLessons.filter(x => !newDays.has(x.day))
  return normalizeLessons([...kept, ...newLessons])
}

// Сценарий из бага: в базе висит старая "Среда" (22.04), заливаем фото с "Пятницей" (27.02).
const oldLessons = [
  {day:'Среда', lesson:2, subject:'206общ у/ 217хим у э', time:'08:50', room:''},
  {day:'Среда', lesson:3, subject:'102лит', time:'09:45', room:''},
  {day:'Среда', lesson:4, subject:'102лит', time:'10:45', room:''},
  {day:'Среда', lesson:5, subject:'103геог', time:'11:45', room:''},
]
const newLessons = [
  {day:'Пятница', lesson:1, subject:'био у з', time:'09:45', room:'304'},
  {day:'Пятница', lesson:2, subject:'рус', time:'10:45', room:'302'},
  {day:'Пятница', lesson:3, subject:'лит', time:'12:35', room:'302'},
]
const merged = mergeByDay(oldLessons, newLessons)

// Среда должна остаться как была (её не было на новом фото).
assert.equal(merged.filter(x => x.day === 'Среда').length, 4)
// Пятница должна быть только новой версией — 3 урока, без дублей.
assert.equal(merged.filter(x => x.day === 'Пятница').length, 3)
assert.deepEqual(merged.filter(x => x.day === 'Пятница').map(x => x.subject), ['био у з','рус','лит'])

// Повторная заливка ТОЙ ЖЕ пятницы с исправленными данными должна заменить предыдущую пятницу, а не добавиться к ней.
const fixedFriday = [
  {day:'Пятница', lesson:1, subject:'био у з', time:'09:45', room:'304'},
  {day:'Пятница', lesson:2, subject:'рус', time:'10:45', room:'302'},
  {day:'Пятница', lesson:3, subject:'лит', time:'12:35', room:'302'},
  {day:'Пятница', lesson:4, subject:'302лит', time:'12:35', room:'302'},
  {day:'Пятница', lesson:5, subject:'302лит', time:'12:35', room:'302'},
  {day:'Пятница', lesson:6, subject:'206общ б', time:'12:35', room:''},
  {day:'Пятница', lesson:7, subject:'217хим б', time:'13:25', room:''},
]
const mergedAgain = mergeByDay(merged, fixedFriday)
assert.equal(mergedAgain.filter(x => x.day === 'Среда').length, 4)
assert.equal(mergedAgain.filter(x => x.day === 'Пятница').length, 7)

console.log('schedule day-merge: OK')
