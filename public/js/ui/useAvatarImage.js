import {useEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {useAssetImage} from './useAssetImage.js';

/** Animate only visible profile avatars; static art stays available for failed or disabled animation. */
export function useAvatarImage(source,animation){
 const ref=useRef(null),[visible,setVisible]=useState(false),[allowed,setAllowed]=useState(false);
 useEffect(()=>{
  if(!animation)return;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setAllowed(!document.hidden&&!media.matches);
  update();document.addEventListener('visibilitychange',update);media.addEventListener('change',update);
  return ()=>{document.removeEventListener('visibilitychange',update);media.removeEventListener('change',update);};
 },[animation]);
 useEffect(()=>{
  if(!animation||!ref.current)return;
  if(!window.IntersectionObserver){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));
  observer.observe(ref.current);
  return ()=>observer.disconnect();
 },[animation]);
 const still=useAssetImage(source),moving=useAssetImage(animation&&visible&&allowed?animation:null);
 const [loaded,setLoaded]=useState(null);
 // Keep the still visible until the animation has decoded, including recovery through the asset transport.
 useEffect(()=>{
  if(!moving.src)return;
  let disposed=false;const image=new Image();
  image.onload=()=>{if(!disposed)setLoaded(moving.src);};
  image.onerror=()=>{if(!disposed)moving.onError();};image.src=moving.src;
  return ()=>{disposed=true;image.onload=image.onerror=null;image.removeAttribute('src');};
 },[moving.src]);
 const picture=moving.src&&loaded===moving.src?moving:still;
 return {...picture,ref};
}
