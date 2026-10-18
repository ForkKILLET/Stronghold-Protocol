// Reuse shipped language packs without loading game data, plugin indexes or the game bootstrap.
import {useEffect,useState} from '../../vendor/hooks.module.js';
import {addMessages,getLang,setLang,onLangChange} from '../../../shared/i18n.js';
const packs=import.meta.glob('../../i18n/*.json',{import:'default'});
export async function initLang(){
  let stored;
  try{stored=JSON.parse(localStorage.getItem('sp.pref.lang'));}catch{}
  const requested=String(new URL(location.href).searchParams.get('lang') || stored || 'zh').replaceAll('_','-').toLowerCase();
  const files=Object.keys(packs),code=file=>file.split('/').pop().replace('.json','').toLowerCase();
  const file=files.find(f=>code(f)===requested) || files.find(f=>code(f)===requested.split('-')[0]);
  if(file){const dict=await packs[file]();const lang=file.split('/').pop().replace('.json','');addMessages(lang,dict);setLang(lang);}
  document.documentElement.lang=getLang();
}
export function useLang(){const [lang,set]=useState(getLang);useEffect(()=>onLangChange(set),[]);return lang;}
