import assert from 'node:assert/strict'

function goal(a, t) {
  const n=a.length, sum=a.reduce((x,y)=>x+y,0), av=n?sum/n:0
  const threshold=t===5?4.5:3.5
  if (!n) return null
  if (av+1e-9>=threshold) return {need:0,next:av}
  const need=Math.max(1,Math.ceil((threshold*n-sum)/(5-threshold)-1e-9))
  return {need,next:(sum+need*5)/(n+need)}
}

assert.deepEqual(goal([3,4],5), {need:4,next:4.5})
assert.deepEqual(goal([3,4],4), {need:0,next:3.5})
assert.equal(goal([4,4],5).need, 2)
console.log('grade goals: OK')
