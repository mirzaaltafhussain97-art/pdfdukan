import fs from 'node:fs';
import assert from 'node:assert/strict';

/* Test the exact engine shipped in the HTML page so the regression suite
   cannot silently drift away from production. */
const html=fs.readFileSync('public/tools/inheritance-calc-advanced.html','utf8');
const start=html.indexOf('const IC = (() => {');
const end=html.indexOf('window.IC = IC;',start);
assert(start>=0&&end>start,'Embedded Faraid engine not found');
const source=html.slice(start,end)
  .replace('const IC =','return')
  .replace('return { calculate, toggleSpouse };','return { calculate, toggleSpouse, computeFaraid };');
const {computeFaraid}=new Function(source)();

const B={gender:'male',wives:0,husband:false,mother:false,father:false,gFather:false,
  maternalGM:false,paternalGM:false,sons:0,daughters:0,gsons:0,gdaughters:0,
  fBro:0,fSis:0,pBro:0,pSis:0,uSib:0,fNephews:0,pNephews:0,fUncles:0,
  pUncles:0,fUncleSons:0,pUncleSons:0};
const near=(a,b)=>Math.abs(a-b)<1e-9;
function verify(name,input,expected,flags={}){
  const result=computeFaraid({...B,...input});
  const got=Object.fromEntries(result.rows.map(row=>[row.label,row.frac]));
  for(const [label,fraction] of Object.entries(expected))
    assert(near(got[label]??-1,fraction),`${name}: ${label} expected ${fraction}, got ${got[label]}`);
  assert.equal(result.aul,!!flags.aul,`${name}: unexpected Aul state`);
  assert.equal(result.radd,!!flags.radd,`${name}: unexpected Radd state`);
  const total=result.rows.reduce((sum,row)=>sum+row.frac,0)+result.residue;
  assert(near(total,1),`${name}: total is ${total}`);
  console.log(`PASS  ${name}`);
}

verify('son and daughter 2:1',{sons:1,daughters:1},{Son:2/3,Daughter:1/3});
verify('wife and parents Umariyya',{wives:1,mother:true,father:true},{Wife:1/4,Mother:1/4,Father:1/2});
verify('husband and parents Umariyya',{gender:'female',husband:true,mother:true,father:true},{Husband:1/2,Mother:1/6,Father:1/3});
verify('husband and two full sisters Aul',{gender:'female',husband:true,fSis:2},{Husband:3/7,'Full sisters':4/7},{aul:true});
verify('daughter only Radd',{daughters:1},{Daughter:1},{radd:true});
verify('wife and daughter Radd',{wives:1,daughters:1},{Wife:1/8,Daughter:7/8},{radd:true});
verify('daughter and father',{daughters:1,father:true},{Daughter:1/2,Father:1/2});
verify('mother reduced by two blocked siblings',{mother:true,father:true,fBro:2},{Mother:1/6,Father:5/6});
verify('Bukhari 6742 daughter granddaughter sister',{daughters:1,gdaughters:1,fSis:1},{Daughter:1/2,"Son's daughter":1/6,'Full sister':1/3});
verify('two daughters block sons daughter',{daughters:2,gdaughters:1},{Daughters:1},{radd:true});
verify('son grandson blocks siblings',{gsons:1,fBro:2,fSis:1},{"Son's son":1});
verify('maternal sibling single',{uSib:1},{'Maternal sibling':1},{radd:true});
verify('full brother and sister 2:1',{fBro:1,fSis:1},{'Full brother':2/3,'Full sisters':1/3});
verify('full sisters and paternal brother',{fSis:2,pBro:1},{'Full sisters':2/3,'Paternal brother':1/3});
verify('father blocks paternal grandmother',{father:true,paternalGM:true,maternalGM:true},{"Mother's mother":1/6,Father:5/6});
verify('mother blocks both grandmothers',{mother:true,maternalGM:true,paternalGM:true},{Mother:1},{radd:true});
verify('two eligible grandmothers share sixth',{maternalGM:true,paternalGM:true},{'Eligible grandmothers':1},{radd:true});
verify('full nephew receives residue',{wives:1,fNephews:2},{Wife:1/4,"Full brother's sons":3/4});
verify('full nephew blocks paternal nephew',{fNephews:1,pNephews:2},{"Full brother's sons":1});
verify('full uncle precedes paternal uncle',{fUncles:1,pUncles:1},{'Full paternal uncles':1});
verify('paternal uncle son as remote residuary',{pUncleSons:2},{"Paternal half-uncle's sons":1});

let fuzzFailures=0;
for(let n=0;n<50000;n++){
  const count=()=>Math.floor(Math.random()*4);
  const input={...B,gender:Math.random()<.5?'male':'female',wives:count(),husband:Math.random()<.5,
    mother:Math.random()<.5,father:Math.random()<.5,gFather:Math.random()<.5,
    maternalGM:Math.random()<.5,paternalGM:Math.random()<.5,sons:count(),daughters:count(),
    gsons:count(),gdaughters:count(),fBro:count(),fSis:count(),pBro:count(),pSis:count(),uSib:count(),
    fNephews:count(),pNephews:count(),fUncles:count(),pUncles:count(),fUncleSons:count(),pUncleSons:count()};
  const result=computeFaraid(input);
  const total=result.rows.reduce((sum,row)=>sum+row.frac,0)+result.residue;
  if(!Number.isFinite(total)||!near(total,1)||result.rows.some(row=>!Number.isFinite(row.frac)||row.frac<0)) fuzzFailures++;
}
assert.equal(fuzzFailures,0,'Random invariant failures detected');
console.log('PASS  50,000 randomized arithmetic/blocking invariants');
console.log('All 21 canonical regressions passed.');
