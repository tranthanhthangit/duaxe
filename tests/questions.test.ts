import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSet, parseQuestionSet, QuestionSession } from '../src/questions/model';
import { RaceModel } from '../src/game/RaceModel';
test('correct answer is recorded once, duplicate/stale/invalid commands cannot grant reward',()=>{
 const s=new QuestionSession(defaultSet);s.sync(1,'running');assert.equal(s.answer('bad','morning'),null);assert.equal(s.answer('sun','bad'),null);
 const result=s.answer('sun','morning');assert.equal(result?.correct,true);assert.equal(result?.responseTime,1);assert.equal(s.answer('sun','morning'),null);assert.equal(s.results.length,1);assert.equal(s.next(),true);assert.equal(s.answer('sun','morning'),null);assert.equal(s.next(),false);assert.deepEqual(s.totals,{correct:1,wrong:0});
});
test('wrong answer cannot be retried and results contain selected IDs and elapsed time',()=>{
 const s=new QuestionSession(defaultSet);s.sync(2.5,'running');assert.deepEqual(s.answer('sun','night'),{questionId:'sun',selectedOptionId:'night',correct:false,responseTime:2.5,timedOut:false});assert.equal(s.answer('sun','morning'),null);assert.deepEqual(s.totals,{correct:0,wrong:1});
});
test('pause freezes question time, rejects answers and next; race resume advances timeout once',()=>{
 const r=new RaceModel(),s=new QuestionSession(defaultSet);r.command({type:'start'});for(let i=0;i<40;i++)r.update(.05);s.sync(r.elapsed,r.status);r.command({type:'pause'});s.sync(r.elapsed,r.status);const remaining=s.remaining;
 for(let i=0;i<500;i++)r.update(.05);s.sync(r.elapsed,r.status);assert.equal(s.remaining,remaining);assert.equal(s.answer('sun','morning'),null);assert.equal(s.next(),false);
 r.command({type:'start'});for(let i=0;i<400;i++)r.update(.05);s.sync(r.elapsed,r.status);assert.equal(s.result?.timedOut,true);assert.equal(s.result?.selectedOptionId,null);assert.equal(s.result?.responseTime,20);s.sync(r.elapsed+1,'running');assert.equal(s.results.length,1);assert.equal(s.answer('sun','morning'),null);
});
test('next question gets a fresh deadline and finishing the set never cycles rewards',()=>{
 const s=new QuestionSession(defaultSet);s.sync(10,'running');s.answer('sun','morning');s.next();assert.equal(s.remaining,20);s.sync(13,'running');assert.equal(s.answer('legs','four')?.responseTime,3);s.next();s.answer('light','green');s.next();assert.equal(s.current,undefined);assert.equal(s.next(),false);assert.equal(s.answer('sun','morning'),null);assert.deepEqual(s.totals,{correct:3,wrong:0});
});
test('restart clears results/deadlines; ready and finished cannot score',()=>{
 const s=new QuestionSession(defaultSet);assert.equal(s.answer('sun','morning'),null);s.sync(2,'running');s.answer('sun','morning');s.next();s.reset();assert.equal(s.index,0);assert.equal(s.remaining,20);assert.deepEqual(s.results,[]);s.sync(0,'ready');assert.equal(s.answer('sun','morning'),null);s.sync(4,'finished');assert.equal(s.answer('sun','morning'),null);s.sync(0,'running');assert.equal(s.answer('sun','morning')?.correct,true);
});
test('JSON roundtrip preserves Vietnamese, order, images, IDs and independent session copies',()=>{
 const set=structuredClone(defaultSet);set.questions.reverse();set.questions[0].image='data:image/png;base64,aGVsbG8=';const parsed=parseQuestionSet(JSON.parse(JSON.stringify(set)));assert.deepEqual(parsed,set);const s=new QuestionSession(parsed);parsed.questions[0].text='changed';assert.notEqual(s.current.text,'changed');
});
test('malformed JSON schemas, duplicate IDs, unsafe images and invalid limits are rejected',()=>{
 for(const value of [null,{},[],{...defaultSet,version:2},{...defaultSet,questions:[]}])assert.throws(()=>parseQuestionSet(value));
 for(const patch of [{options:[]},{options:Array(5).fill({id:'x',text:'A'})},{correctOptionId:'missing'},{timeLimit:0},{timeLimit:121},{timeLimit:5.5},{text:' '},{image:'javascript:alert(1)'},{image:'https://example.com/a.png'}]){const set=structuredClone(defaultSet);Object.assign(set.questions[0],patch);assert.throws(()=>parseQuestionSet(set));}
 const duplicate=structuredClone(defaultSet);duplicate.questions[1].id=duplicate.questions[0].id;assert.throws(()=>parseQuestionSet(duplicate));
 const options=structuredClone(defaultSet);options.questions[0].options[1].id=options.questions[0].options[0].id;assert.throws(()=>parseQuestionSet(options));
});
test('wrong answer clears previous boost without changing obstacle slowdown',()=>{
 const r=new RaceModel();r.command({type:'start'});r.command({type:'boost'});r.command({type:'clearBoost'});r.update(.05);assert.equal(r.boost,0);assert.equal(r.cars[0].speed,29);r.slow=1;r.command({type:'boost'});r.command({type:'clearBoost'});r.update(.05);assert.equal(r.cars[0].speed,14);assert.ok(r.slow>0);
});
