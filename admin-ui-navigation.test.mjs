import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adminUiNavigation} from './admin-ui-navigation.mjs';
const authenticate=async(req,scope='owner')=>req.owner||req.scopes?.includes(scope)||false;
test('global navigation reflects module scopes without exposing other modules',async()=>{
  const html=await adminUiNavigation({scopes:['treinreiziger']},'treinreiziger',{authenticate});
  assert.match(html,/href="\/seinhuis"/);
  assert.match(html,/href="\/seinhuis\/treinreiziger" aria-current="page"/);
  assert.doesNotMatch(html,/Stationschef|KM-trein|Boekjesmaker|FloRA/);
  const owner=await adminUiNavigation({owner:true},'treinreiziger',{authenticate});
  for(const label of ['Seinhuis','Stationschef','KM-trein','Treinreiziger','Boekjesmaker','FloRA'])assert.ok(owner.includes(label));
  assert.equal((owner.match(/aria-current=/g)||[]).length,1);
});
