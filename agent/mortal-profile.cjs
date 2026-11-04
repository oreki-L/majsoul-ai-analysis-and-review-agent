'use strict';
const source=require('./mortal-source.json');
function sourceForProfile(profile=source.profile){
  if(profile===source.profile)return source;
  if(!Object.hasOwn(source.profiles||{},profile))throw new Error('UNKNOWN_MORTAL_PROFILE');
  return {...source,...source.profiles[profile]};
}
module.exports={sourceForProfile};
