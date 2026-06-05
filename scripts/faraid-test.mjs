// Faraid engine — test harness. Validate before embedding in the advanced page.
function computeFaraid(I){
  const E = I.E;
  const sons=I.sons||0, daughters=I.daughters||0;
  let gsons = sons>0?0:(I.gsons||0);
  let gdaughters = sons>0?0:(I.gdaughters||0);
  const maleDesc = sons>0 || gsons>0;
  const anyDesc = sons>0||daughters>0||gsons>0||gdaughters>0;
  const femaleDesc = (daughters>0||gdaughters>0) && !maleDesc;
  const father=!!I.father;
  let gfather = !!I.gFather && !father;
  const mother=!!I.mother;
  let gmothers = mother?0:Math.min(2,I.gMothers||0);
  const totalSibs = (I.fBro||0)+(I.fSis||0)+(I.pBro||0)+(I.pSis||0)+(I.uSib||0);

  // Sibling blocking (Hanafi): male descendant, father, or grandfather block full+paternal siblings
  let fBro=I.fBro||0,fSis=I.fSis||0,pBro=I.pBro||0,pSis=I.pSis||0,ut=I.uSib||0;
  if (maleDesc || father || gfather){ fBro=0;fSis=0;pBro=0;pSis=0; }
  if (fBro>0){ pBro=0;pSis=0; }
  if (fSis>=2 && fBro===0){ pBro=0;pSis=0; }
  if (anyDesc || father || gfather) ut=0;   // uterine blocked by any descendant + father + grandfather

  const rows=[]; let fixedSum=0;
  const fixed=(label,count,frac,note)=>{ rows.push({label,count,frac,note,kind:'fixed'}); fixedSum+=frac; };

  // Spouse
  let spouseFrac=0, spouseLabel='', spouseCount=1;
  if(I.gender==='male' && (I.wives||0)>0){ spouseFrac=anyDesc?1/8:1/4; spouseCount=I.wives; spouseLabel=I.wives>1?'Each wife':'Wife'; }
  else if(I.gender==='female' && I.husband){ spouseFrac=anyDesc?1/4:1/2; spouseLabel='Husband'; }

  const umariyya = spouseFrac>0 && father && mother && !anyDesc && totalSibs===0;
  if(spouseFrac>0) fixed(spouseLabel, spouseCount, spouseFrac, frac2(spouseFrac));

  // Mother
  if(mother){
    if(umariyya){ const mf=(1-spouseFrac)/3; fixed('Mother',1,mf,'1/3 of remainder (Umariyyatayn)'); }
    else { const mf=(anyDesc||totalSibs>=2)?1/6:1/3; fixed('Mother',1,mf,frac2(mf)); }
  }
  if(gmothers>0) fixed(gmothers>1?'Grandmothers':'Grandmother', gmothers, 1/6, '1/6 shared');

  // Father / Grandfather
  let fatherAsaba=false, gfatherAsaba=false;
  if(father){
    if(maleDesc) fixed('Father',1,1/6,'1/6');
    else if(femaleDesc){ fixed('Father',1,1/6,'1/6 + residue'); fatherAsaba=true; }
    else fatherAsaba=true;
  } else if(gfather){
    if(maleDesc) fixed('Grandfather',1,1/6,'1/6');
    else if(femaleDesc){ fixed('Grandfather',1,1/6,'1/6 + residue'); gfatherAsaba=true; }
    else gfatherAsaba=true;
  }

  // Daughters (no sons)
  if(sons===0 && daughters>0){ const df=daughters===1?1/2:2/3; fixed(daughters>1?'Daughters':'Daughter',daughters,df,frac2(df)); }
  // Granddaughters via son (no sons)
  if(sons===0 && gsons===0 && gdaughters>0){
    if(daughters===0){ const g=gdaughters===1?1/2:2/3; fixed(gdaughters>1?"Son's daughters":"Son's daughter",gdaughters,g,frac2(g)); }
    else if(daughters===1){ fixed(gdaughters>1?"Son's daughters":"Son's daughter",gdaughters,1/6,'1/6 (completes 2/3)'); }
  }
  // Uterine siblings
  if(ut>0){ const uf=ut===1?1/6:1/3; fixed(ut>1?'Maternal siblings':'Maternal sibling',ut,uf,frac2(uf)); }

  // Full / paternal sisters as fixed sharers (no brothers, no female-descendant)
  let fullSisAsaba=false, patSisAsaba=false;
  if(fSis>0 && fBro===0){
    if(femaleDesc) fullSisAsaba=true;
    else { const s=fSis===1?1/2:2/3; fixed(fSis>1?'Full sisters':'Full sister',fSis,s,frac2(s)); }
  }
  if(pSis>0 && pBro===0 && fBro===0 && fSis<2){
    if(femaleDesc) patSisAsaba=true;
    else if(fSis===1) fixed(pSis>1?'Paternal sisters':'Paternal sister',pSis,1/6,'1/6 (completes 2/3)');
    else if(fSis===0){ const s=pSis===1?1/2:2/3; fixed(pSis>1?'Paternal sisters':'Paternal sister',pSis,s,frac2(s)); }
  }

  // AWL — fixed shares exceed estate
  let aul=false;
  if(fixedSum > 1.0000001){
    aul=true; const k=fixedSum;
    rows.forEach(r=>r.frac=r.frac/k);
    fixedSum=1;
  }

  // ASABA residue
  let residue = 1 - fixedSum;
  if(residue < 1e-9) residue = 0;
  let asabaAssigned=false;
  const pushA=(label,count,frac,note)=>{ rows.push({label,count,frac,note,kind:'asaba'}); asabaAssigned=true; };
  if(!aul && residue>0){
    if(sons>0){ const u=sons*2+daughters; pushA(sons>1?'Each son':'Son',sons,residue*(sons*2)/u,'residue 2:1'); if(daughters>0) pushA(daughters>1?'Daughters':'Daughter',daughters,residue*daughters/u,'residue 2:1'); }
    else if(gsons>0){ const u=gsons*2+gdaughters; pushA("Son's sons",gsons,residue*(gsons*2)/u,'residue 2:1'); if(gdaughters>0) pushA("Son's daughters",gdaughters,residue*gdaughters/u,'residue 2:1'); }
    else if(fatherAsaba){ mergeAdd(rows,'Father',1,residue,'1/6 + residue (asaba)'); asabaAssigned=true; }
    else if(gfatherAsaba){ mergeAdd(rows,'Grandfather',1,residue,'1/6 + residue (asaba)'); asabaAssigned=true; }
    else if(fBro>0){ const u=fBro*2+fSis; pushA(fBro>1?'Full brothers':'Full brother',fBro,residue*(fBro*2)/u,'residue 2:1'); if(fSis>0) pushA('Full sisters',fSis,residue*fSis/u,'residue 2:1'); }
    else if(fullSisAsaba){ pushA(fSis>1?'Full sisters':'Full sister',fSis,residue,'residue (with daughters)'); }
    else if(pBro>0){ const u=pBro*2+pSis; pushA(pBro>1?'Paternal brothers':'Paternal brother',pBro,residue*(pBro*2)/u,'residue 2:1'); if(pSis>0) pushA('Paternal sisters',pSis,residue*pSis/u,'residue 2:1'); }
    else if(patSisAsaba){ pushA(pSis>1?'Paternal sisters':'Paternal sister',pSis,residue,'residue (with daughters)'); }
  }

  // RADD — leftover with no asaba: redistribute to fixed sharers except spouse
  let radd=false;
  if(!aul && residue>0 && !asabaAssigned){
    const isSpouse = r => /wife|husband/i.test(r.label);
    const base = rows.filter(r=>r.kind==='fixed' && !isSpouse(r)).reduce((s,r)=>s+r.frac,0);
    if(base>0){
      radd=true;
      rows.forEach(r=>{ if(r.kind==='fixed' && !isSpouse(r)) r.frac += residue*(r.frac/base); });
      residue=0;
    }
  }

  return { rows, E, aul, radd, residue };

  function frac2(f){ const m=[[1/8,'1/8'],[1/4,'1/4'],[1/2,'1/2'],[1/6,'1/6'],[1/3,'1/3'],[2/3,'2/3']]; for(const [v,s] of m) if(Math.abs(f-v)<1e-9) return s; return (f*100).toFixed(2)+'%'; }
  function mergeAdd(rows,label,count,addFrac,note){ const r=rows.find(x=>x.label===label); if(r){ r.frac+=addFrac; r.note=note; r.kind='asaba'; } else rows.push({label,count,frac:addFrac,note,kind:'asaba'}); }
}

// ── TESTS ──
function run(name,I,expect){
  const r=computeFaraid(I);
  let total=0; const out=[];
  r.rows.forEach(row=>{ const per=row.frac/row.count; total+=row.frac; out.push(`${row.label}: ${(per*100).toFixed(2)}% each (grp ${(row.frac*100).toFixed(2)}%) [${row.note}]`); });
  console.log('\n=== '+name+(r.aul?' [AUL]':'')+(r.radd?' [RADD]':'')+' ===');
  out.forEach(o=>console.log('  '+o));
  console.log('  GROUP TOTAL: '+(total*100).toFixed(2)+'%'+(r.residue>1e-6?'  (leftover '+(r.residue*100).toFixed(2)+'%)':''));
  if(expect) console.log('  EXPECT: '+expect);
}

run('Wife + 5 sons + 3 daughters', {E:3500000,gender:'male',wives:1,sons:5,daughters:3}, 'wife 12.5, son 13.46 each, daughter 6.73 each');
run('Husband+mother+father (Umariyyatayn)', {E:1,gender:'female',husband:true,mother:true,father:true}, 'husband 1/2, mother 1/6, father 1/3');
run('Wife+mother+father (Umariyyatayn)', {E:1,gender:'male',wives:1,mother:true,father:true}, 'wife 1/4, mother 1/4, father 1/2');
run('Husband+mother+2 daughters (AUL)', {E:1,gender:'female',husband:true,mother:true,daughters:2}, 'husband 3/13=23.08, mother 2/13=15.38, daughters 8/13=61.54');
run('Daughter + full sister', {E:1,gender:'male',daughters:1,fSis:1}, 'daughter 1/2, full sister residue 1/2');
run('Mother + 2 daughters (RADD, no spouse)', {E:1,gender:'male',mother:true,daughters:2}, 'mother 1/5=20, daughters 4/5=80 (40 each)');
run('Husband + mother + 1 full sister', {E:1,gender:'female',husband:true,mother:true,fSis:1}, 'husband 1/2, mother 1/3, full sister 1/2 -> AUL 6/8,? actually sum=1/2+1/3+1/2=4/3 aul');
run('Wife + 2 uterine siblings + 1 full brother', {E:1,gender:'male',wives:1,uSib:2,fBro:1}, 'wife 1/4, uterine 1/3, full brother residue 5/12');
run('Father + mother + 1 son (no spouse)', {E:1,gender:'female',father:true,mother:true,sons:1}, 'father 1/6, mother 1/6, son residue 2/3');
