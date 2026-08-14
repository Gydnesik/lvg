import assert from 'node:assert/strict'

const CLASSES = ['5А','5Б','5В','5Г','6А','6Б','6В','6Г','7А','7Б','7В','7Г','8А','8Б','8В','8Г','9А','9Б','9В','9Г','10А','10Б','10В','10Г','11А','11Б','11В','11Г']
const DAY_ORDER = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']
const LATIN = {A:'А',B:'В',C:'С',E:'Е',H:'Н',K:'К',M:'М',O:'О',P:'Р',T:'Т',X:'Х',Y:'У'}

function normalizeClassName(value){
  let s=String(value??'').trim().toUpperCase().replace(/КЛАСС/giu,'').replace(/[\s._\-–—:№]+/g,'')
  for(const [a,c] of Object.entries(LATIN)) s=s.split(a).join(c)
  return CLASSES.includes(s)?s:null
}
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
function normalizeScheduleRows(rows){
  const groups={}
  for(const row of Array.isArray(rows)?rows:[]){
    const c=normalizeClassName(row.class_name??row.className??row.class??row.name)
    if(!c) continue
    ;(groups[c]??=[]).push(...normalizeLessons(row.lessons))
  }
  for(const c of Object.keys(groups)) groups[c]=normalizeLessons(groups[c])
  return groups
}

assert.equal(normalizeClassName('8а'),'8А')
assert.equal(normalizeClassName('8А'),'8А')
assert.equal(normalizeClassName('8 а'),'8А')
assert.equal(normalizeClassName('8-А'),'8А')
assert.equal(normalizeClassName('8A'),'8А')
assert.equal(normalizeClassName(' 8 а класс '),'8А')
assert.equal(normalizeClassName('8B'),'8В')
assert.equal(normalizeClassName('8Д'),null)

const result=normalizeScheduleRows([
  {class_name:'8а',lessons:[{day:'Вт',lesson:2,subject:'История',time:'09:20',room:'12'}]},
  {class_name:'8 А',lessons:[{day:'Понедельник',lesson:1,subject:'Математика',time:'08:30',room:'1'}]},
  {class_name:'8A',lessons:[{day:'Пн',lesson:1,subject:'Математика',time:'08:30',room:'1'}]},
  {class_name:'8 а',lessons:[{day:'Среда',lesson:3,subject:'Русский язык',time:'10:20',room:''}]},
])
assert.deepEqual(Object.keys(result),['8А'])
assert.equal(result['8А'].length,3)
assert.deepEqual(result['8А'].map(x=>x.lesson),[1,2,3])
assert.deepEqual(result['8А'].map(x=>x.day),['Понедельник','Вторник','Среда'])
console.log('schedule normalization: OK')
