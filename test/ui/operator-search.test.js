import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operatorSearch, normalizeOperatorSearch } from '../../public/js/ui/operatorSearch.js';
import { SEARCH_READINGS, OPERATOR_SEARCH_NAMES } from '../../public/js/ui/searchReadings.js';
import { parseReadings, searchVocabulary } from '../../tools/build-search-pinyin.mjs';
import { filterRoster } from '../../public/js/ui/loadoutModel.js';
import { filterCardOperators } from '../../public/js/ui/opPicker.js';
import { searchProfileAvatars } from '../../public/js/ui/profile.js';

test('full pinyin, initials, partial spelling, tones and mixed Chinese share one matcher', () => {
  for (const query of ['缪尔赛思', 'miuersaisi', 'MIU ER SAI SI', 'mess', 'miù ěr sài sī', 'ersai', '缪ersaisi', 'miu尔赛思']) {
    assert.equal(operatorSearch(query)(['缪尔赛思']), true, query);
  }
  for (const query of ['amiya', 'AMY', '阿miya', 'AMI YA']) assert.equal(operatorSearch(query)(['阿米娅']), true, query);
  for (const query of ['chongyue', 'cy']) assert.equal(operatorSearch(query)(['重岳']), true, query);
  for (const query of ['qiubai', 'qb']) assert.equal(operatorSearch(query)(['仇白']), true, query);
  for (const query of ['bolv', 'bo lǜ', 'bl', 'baolv']) assert.equal(operatorSearch(query)(['薄绿']), true, query);
  assert.equal(operatorSearch('weinaweiduoliya')(['维娜·维多利亚']), true);
  assert.equal(operatorSearch('nengtianshi')(['能天使']), true);
});

test('ordinary spelling, stable ids, localisation and empty/nonmatching input remain searchable', () => {
  const fields = ['缪尔赛思', 'Muelsyse', 'char_249_mlyss'];
  assert.equal(operatorSearch(' muELsYse ')(fields), true);
  assert.equal(operatorSearch('CHAR_249_MLYSS')(fields), true);
  assert.equal(operatorSearch('mess')(['ミュルジス'], 'char_249_mlyss'), true, 'Chinese aliases survive a UI language change');
  assert.equal(operatorSearch('ミュルジス')(['ミュルジス']), true);
  assert.equal(operatorSearch('ブローカ')(['ブローカ']), true, 'kana dakuten is not stripped');
  assert.notEqual(normalizeOperatorSearch('ブ'), normalizeOperatorSearch('フ'));
  assert.equal(operatorSearch('')([]), true);
  assert.equal(operatorSearch(' \t ')([]), true);
  for (const query of ['---', '...', 'not an operator', 'zxqv']) assert.equal(operatorSearch(query)(fields), false, query);
  assert.equal(operatorSearch('constructor')(['阿米娅'], 'constructor'), false);
  assert.equal(operatorSearch('amy')(['史尔特尔']), false);
});

test('polyphonic matching avoids Cartesian expansion and works across repeated syllables', () => {
  assert.equal(operatorSearch('chong'.repeat(32))(['重'.repeat(32)]), true);
  assert.equal(operatorSearch('zhong'.repeat(31) + 'x')(['重'.repeat(32)]), false);
  assert.equal(operatorSearch('nana')(['娜娜米']), true);
});

test('roster/card-counter filters and seat operator/avatar/portrait pickers keep category filters and order', () => {
  const mu = { name: '缪尔赛思', charId: 'char_249_mlyss', tier: 6, rarity: 6, profession: 'PIONEER', subProfessionName: '战术家', bonds: ['rhine'] };
  const amy = { name: '阿米娅', charId: 'char_002_amiya', tier: 2, rarity: 5, profession: 'CASTER', bonds: [] };
  const list = [amy, mu];
  assert.deepEqual(filterRoster(list, { query: 'mess' }), [mu]);
  assert.deepEqual(filterRoster(list, { query: 'zhanshujia' }), [mu]);
  assert.deepEqual(filterRoster(list, { query: 'xlg' }, {}, () => null, () => ({ name: '谢拉格' })), [mu]);
  assert.deepEqual(filterRoster(list, { query: 'mess', tier: 4 }), []);
  assert.deepEqual(filterRoster(list, { query: 'mess', prof: 'CASTER' }), []);
  assert.deepEqual(filterRoster(list, { query: 'mess', bond: 'other' }), []);
  assert.deepEqual(filterCardOperators(list, 'mess', 6), [mu]);
  assert.deepEqual(filterCardOperators(list, 'mess', 5), []);
  assert.deepEqual(filterCardOperators(list), list);
  assert.deepEqual(list, [amy, mu]);
});

test('profile avatar search keeps grouping, ids and the catalogue order', () => {
  const avatars = { first: { name: '阿米娅', group: 'default' }, second: { name: '缪尔赛思', group: 'special' }, third: { name: '阿米娅·贺岁', group: 'special' } };
  assert.deepEqual(searchProfileAvatars(avatars, 'all', 'amy').map(a => a.id), ['first', 'third']);
  assert.deepEqual(searchProfileAvatars(avatars, 'default', 'mess'), []);
  assert.deepEqual(searchProfileAvatars(avatars, 'special', 'mess').map(a => a.id), ['second']);
  assert.deepEqual(searchProfileAvatars(avatars, 'all', 'SECOND').map(a => a.id), ['second']);
});

test('fixed Unicode field parser handles dictionary offsets, tone/ü and ignores commented field descriptions', () => {
  const text = '#\tkMandarin\tcomment\nU+7F2A\tkMandarin\tmóu\nU+7F2A\tkXHC1983\t0789.010:miào 0798.020:miù\nU+7EFF\tkTGHZ2013\t111.020*,111.030:lǜ\n';
  assert.deepEqual(parseReadings(text, new Set(['缪', '绿']), ['kMandarin', 'kXHC1983', 'kTGHZ2013']), { 绿: ['lv'], 缪: ['miao', 'miu', 'mou'] });
});

test('generated readings cover every shipped searchable Han character and stable operator name', async () => {
  const { chars, names } = await searchVocabulary();
  assert.deepEqual(names, OPERATOR_SEARCH_NAMES, 'regenerate when adding or renaming an operator');
  assert.deepEqual([...chars].filter(char => !SEARCH_READINGS[char]), [], 'regenerate after changing searchable labels');
  const source = JSON.parse(await readFile(new URL('../../tools/search-pinyin-sources.json', import.meta.url), 'utf8'));
  assert.match(source.url, /^https:\/\/www\.unicode\.org\/Public\/17\.0\.0\//);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
});
