import assert from 'node:assert/strict'

// Regression fixture for the exact failure pattern from the school workbook:
// 11А/11Б share one merged lesson after the 6th lesson, while 8Г has its own
// 7th and 8th lessons. The importer must keep columns independent.
const header = ['8Г','9А','10А','10Б','11А','11Б']
const rows = [
  ['8.00','1','301кл/ч','307кл/ч','302лит','306кл/ч','212кл/ч','206кл/ч'],
  ['8.50','2','101геог','217хим','206мат','217мат','104мат у/ 307мат у/ 305мат б','104мат у/ 307мат у/ 305мат б'],
  ['9.45','3','207мат','205кл/ч','206мат','217мат','104мат у/ 307мат у/ 305мат б','104мат у/ 307мат у/ 305мат б'],
  ['10.45','4','207мат','102рус','физ-ра','физ-ра','физ-ра','физ-ра'],
  ['11.45','5','301рус','213физ','106анг','303рус','303рус','308обзр'],
  ['12.35','6','217хим','306физ','201кл/ч','303рус','303рус','102рус'],
  ['13.25','7','106анг/ 201инф','102лит','306физ б/ 213физ у','206общ б','206общ б','206общ б/ 205ист у'],
  ['14.20','8','301рус','102лит','306физ б/ 213физ у','206общ б','206общ б','206общ б/ 205ист у'],
]

function normalizeClassName(v) {
  const s = String(v).trim().toUpperCase().replace(/[\s._\-–—:№]+/g,'')
  const m = s.match(/^(5|6|7|8|9|10|11)([А-Я])$/u)
  return m ? `${m[1]}${m[2]}` : null
}

const classColumns = new Map()
header.forEach((v,i)=>classColumns.set(i+2, normalizeClassName(v)))
assert.equal(classColumns.get(0), undefined)
assert.equal(classColumns.get(6), '11А')
assert.equal(classColumns.get(7), '11Б')

const parsed = Object.fromEntries([...classColumns.values()].map(c=>[c,[]]))
for (const row of rows) {
  const time=row[0], lesson=Number(row[1])
  for (const [col, cls] of classColumns) {
    const cell=row[col]
    if (!cell) continue
    parsed[cls].push({lesson,time,cell})
  }
}

assert.deepEqual(parsed['11А'].map(x=>x.lesson), [1,2,3,4,5,6,7,8])
assert.deepEqual(parsed['11Б'].map(x=>x.lesson), [1,2,3,4,5,6,7,8])
assert.deepEqual(parsed['8Г'].map(x=>x.lesson), [1,2,3,4,5,6,7,8])
assert.equal(parsed['11А'][6].cell, '206общ б')
assert.equal(parsed['11Б'][6].cell, '206общ б/ 205ист у')
assert.equal(parsed['8Г'][6].cell, '106анг/ 201инф')
assert.equal(parsed['8Г'][7].cell, '301рус')

console.log('schedule grid regression: OK')
