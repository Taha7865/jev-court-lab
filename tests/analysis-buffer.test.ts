import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasInitialAnalysisBuffer,playbackLimit} from '../lib/analysis-buffer.ts';

test('the playback boundary reserves processed frames while analysis continues',()=>{
  assert.equal(playbackLimit(8,60,true),7.5);
  assert.equal(playbackLimit(.25,60,true),0);
  assert.equal(playbackLimit(80,60,true),60);
  assert.equal(playbackLimit(8,60,false),60);
});
test('short clips do not wait for an impossible ten second buffer',()=>{
  assert.equal(hasInitialAnalysisBuffer(9,9),true);
  assert.equal(hasInitialAnalysisBuffer(9,60),false);
  assert.equal(hasInitialAnalysisBuffer(10,60),true);
});
