import {h} from '../../vendor/preact.module.js';
import {useAvatarImage} from './useAvatarImage.js';

/** Unframed avatar for selection grids and player nameplates, with the same lifecycle as AvatarFrame. */
export function AvatarImage({src,animation,alt='',fallback=null,class:cls}){
 const picture=useAvatarImage(src,animation);
 return picture.src?h('img',{ref:picture.ref,src:picture.src,onError:picture.onError,alt,class:cls,draggable:false,loading:'lazy'})
  :h('span',{ref:picture.ref,class:cls},fallback);
}
