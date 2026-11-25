/* Gravedad: controller only. Physics and pixel transforms run in the C++ effects. */
if(typeof JSON==='undefined')$.evalFile(new File(new File($.fileName).parent.fsName+'/json2.js'));
$.evalFile(new File(new File($.fileName).parent.fsName+'/geometry.jsx'));
var GravedadNative=(function(){
 // Effect parameter indices (see src/Parameters.hpp).
 var B={enabled:1,mode:2,shape:3,hollow:4,thickness:5,width:13,height:14,cx:15,cy:16,walls:20,start:21,duration:22,revision:23,environment:27,bake:32,bodyStart:33,fan:34,hash:35};
 var W={gravity:1,walls:2,start:3,duration:4,simulation:5,environment:6,revision:7,bake:8};
 var P={enabled:1,layer:2,rate:3,max:4,width:7,speed:9,spread:11,sizeVariation:13,radius:17,start:24,bake:27,emitter:28};
 var match='Eneko Gravedad Body',worldMatch='Eneko Gravedad Mundo',particlesMatch='Eneko Gravedad Particulas',revision=Math.floor(Math.random()*900000),bodySignatures={},compKeys={},cursors={};
 // Dialogs are suppressed while the panel talks to After: a failed read during the user's own edits must never block After.
 function wrap(fn){var quiet=false;try{app.beginSuppressDialogs();quiet=true;}catch(ignore){}try{return JSON.stringify({ok:true,data:fn()});}catch(e){return JSON.stringify({ok:false,error:e.toString(),line:e.line});}finally{if(quiet)try{app.endSuppressDialogs(false);}catch(ignore){}}}
 function comp(passive){var c=app.project&&app.project.activeItem;if(!(c instanceof CompItem)&&!passive&&app.activeViewer&&app.activeViewer.type===ViewerType.VIEWER_COMPOSITION){app.activeViewer.setActive();c=app.project.activeItem;}if(!(c instanceof CompItem))throw Error('Abre una composición.');return c;}
 function effectOf(layer,name){var effects=layer.property('ADBE Effect Parade');if(!effects)return null;for(var i=1;i<=effects.numProperties;i++)if(effects.property(i).matchName===name)return effects.property(i);return null;}
 function body(layer){return effectOf(layer,match);}
 function all(c){var list=[];for(var i=1;i<=c.numLayers;i++){var l=c.layer(i),e=body(l);if(e)list.push({layer:l,effect:e});}return list;}
 function emitters(c){var list=[];for(var i=1;i<=c.numLayers;i++){var e=effectOf(c.layer(i),particlesMatch);if(e)list.push({layer:c.layer(i),effect:e});}return list;}
 // Writing a property is the costly part in After: only write values that change.
 function set(e,index,value){var p=e.property(index);if(p.value!==value)p.setValue(value);}
 // Locked layers (the particle render layer) are unlocked only for the write.
 function setOn(item,name,index,value){var l=item.layer,locked=l.locked;if(locked)l.locked=false;try{set(effectOf(l,name),index,value);}finally{if(locked)l.locked=true;}}
 function duration(c){return Math.min(120,7200/c.frameRate,c.workAreaDuration);}
 // The world controller: one solid per composition holding gravity, walls and timing, like a simulation scene object.
 function world(c){for(var i=1;i<=c.numLayers;i++){var e=effectOf(c.layer(i),worldMatch);if(e)return {layer:c.layer(i),effect:e};}return null;}
 function ensureWorld(c){var w=world(c);if(w)return w;var solid=c.layers.addSolid([.16,.14,.2],'Gravedad · Mundo',c.width,c.height,c.pixelAspect,c.duration);
  if(!solid.property('ADBE Effect Parade').addProperty(worldMatch)){solid.remove();throw Error('Instala Gravedad 0.6 y reinicia After una vez.');}
  solid.enabled=false;solid.guideLayer=true;solid.moveToEnd();w=world(c);set(w.effect,W.start,c.workAreaStart);set(w.effect,W.duration,duration(c));return world(c);}
 function animated(l){return l.transform.position.numKeys||l.transform.rotation.numKeys||l.transform.position.expressionEnabled||l.transform.rotation.expressionEnabled;}
 function shapes(layer){var count={ellipse:0,rect:0,other:0,turned:false,rounded:false};function walk(g){for(var i=1;i<=g.numProperties;i++){var p=g.property(i);if(p.enabled===false)continue;var n=p.matchName;
  if(n==='ADBE Vector Shape - Ellipse')count.ellipse++;else if(n==='ADBE Vector Shape - Rect'){count.rect++;if(p.property('ADBE Vector Rect Roundness').value>.5)count.rounded=true;}else if(n==='ADBE Vector Shape - Group'||n==='ADBE Vector Shape - Star'||n.indexOf('ADBE Vector Filter')===0)count.other++;
  else if(n==='ADBE Vector Transform Group'){if(p.property('ADBE Vector Rotation').value%360!==0||p.property('ADBE Vector Skew').value!==0)count.turned=true;}
  if(p.propertyType!==PropertyType.PROPERTY)walk(p);}}walk(layer.property('ADBE Root Vectors Group'));return count;}
 function uniform(l){var k=l.transform.scale.value;return Math.abs(Math.abs(k[0])-Math.abs(k[1]))<.01;}
 // Simple outlines become presets that the effect measures itself on every frame: circles and plain rectangles.
 function preset(l,c){if(!(l instanceof ShapeLayer))return 0;var k=shapes(l),r=l.sourceRectAtTime(c.workAreaStart,false);
  if(k.ellipse===1&&k.rect===0&&k.other===0&&!k.turned&&uniform(l)&&Math.abs(r.width-r.height)<=Math.max(.5,r.width*.01))return 2;
  if(k.rect===1&&k.ellipse===0&&k.other===0&&!k.turned&&!k.rounded)return 1;return 0;}
 function validate(layer){if(layer.threeDLayer||layer.parent||!layer.enabled)throw Error(layer.name+': usa una capa visible 2D, sin padre.');var t=layer.property('ADBE Transform Group');if(t.property('ADBE Scale').numKeys||t.property('ADBE Scale').expressionEnabled||t.property('ADBE Anchor Point').numKeys||t.property('ADBE Anchor Point').expressionEnabled)throw Error(layer.name+': escala y anclaje deben ser constantes.');if(t.property('ADBE Position').dimensionsSeparated||layer.timeRemapEnabled||layer.stretch!==100)throw Error(layer.name+': precompón las dimensiones separadas, remapeo o estiramiento.');}
 function geometryStamp(layer,time){var values=[];function walk(group){if(!group)return;for(var j=1;j<=group.numProperties;j++){var p=group.property(j);if(p.name.indexOf('__Gravedad_')===0)continue;if(p.propertyType!==PropertyType.PROPERTY){walk(p);continue;}try{var v=p.valueAtTime(time,false);values.push(p.matchName,p.enabled);if(v&&v.vertices)values.push(v.vertices,v.inTangents,v.outTangents,v.closed);else if(v&&v.text!==undefined)values.push(v.text,v.font,v.fontSize,v.tracking,v.leading);else values.push(v);}catch(ignore){}}}if(layer instanceof ShapeLayer)walk(layer.property('ADBE Root Vectors Group'));if(layer instanceof AVLayer)walk(layer.property('ADBE Mask Parade'));if(layer instanceof TextLayer)walk(layer.property('ADBE Text Properties'));return JSON.stringify(values);}
 // Geometry fingerprint stored in the effect itself: it travels with duplicates and survives reloading the panel.
 function hash(text){var h=5381;for(var i=0;i<text.length;i++)h=((h*33)^text.charCodeAt(i))>>>0;return h;}
 // What the simulation reads from a body: its effect values and its transform. Animation is sampled over the work area
 // instead of walking keys by index, which can fail while the user is dragging those keys.
 function bodySignature(l,e,c){var s=[e.enabled,l.enabled,l.index];for(var k=1;k<=34;k++)if(k!==B.revision)s.push(e.property(k).value);var t=l.property('ADBE Transform Group'),names=['ADBE Anchor Point','ADBE Position','ADBE Scale','ADBE Rotate Z'];
  for(var j=0;j<names.length;j++){var p=t.property(names[j]);if(!p)continue;s.push(p.valueAtTime(c.workAreaStart,false),p.numKeys,p.expressionEnabled?p.expression:'');
   if(p.numKeys||p.expressionEnabled)for(var n=0;n<=32;n++)s.push(p.valueAtTime(c.workAreaStart+c.workAreaDuration*n/32,false));}
  return JSON.stringify(s);}
 function compKey(c,list){var ids=[];for(var i=0;i<list.length;i++)ids.push(list[i].layer.id);return [c.workAreaStart,c.workAreaDuration,c.frameRate,c.width,c.height,ids.join(',')].join('|');}
 // After keeps rendered frames of layers whose own values did not change: the image cache is dropped so every body shows the new world.
 function purge(){try{app.purge(PurgeTarget.IMAGE_CACHES);}catch(ignore){}}
 // One write on the world controller (or the first body in older projects) tells every layer the scene changed.
 // Callers wrap it in their own undo group: After warns about nested groups.
 function refresh(c,list){revision=(revision+1)%1000000;var w=world(c);if(w){w.effect.property(W.revision).setValue(revision);
  // After keeps the particle layer's frames while its own values stay the same, even after a purge. With a world controller
  // the emitter's hidden start is unused, so toggling it between 0 and 0.01 s (less than a frame, should the world be
  // deleted later) makes After render the particles against the new scene.
  var em=emitters(c);for(var n=0;n<em.length;n++)setOn(em[n],particlesMatch,P.start,em[n].effect.property(P.start).value===0?.01:0);
  // Dynamic layers too: After reuses the output rectangle of frames it already drew, so a body that now lands elsewhere
  // would be clipped away. Their own revision (unused with a world controller) changes with every refresh.
  for(var k=0;k<list.length;k++)if(list[k].effect.property(B.mode).value===2)list[k].effect.property(B.revision).setValue(revision);}else for(var i=0;i<list.length;i++)if(list[i].effect.enabled&&list[i].effect.property(1).value){list[i].effect.property(B.revision).setValue(revision);break;}purge();}
 function summary(c,list){var active=false,both=list.concat(emitters(c)),w=world(c);for(var n=0;n<both.length;n++)if(both[n].effect.enabled&&both[n].effect.property(1).value){active=true;break;}
  return {compId:c.id,name:c.name,count:list.length,emitters:both.length-list.length,revision:w?w.effect.property(W.revision).value:null,active:active,world:!!w,environment:w&&w.effect.property(W.gravity).value===0?2:1,walls:w?!!w.effect.property(W.walls).value:false};}
 function removeStored(layer){var masks=layer.property('ADBE Mask Parade');for(var i=masks.numProperties;i>=1;i--)if(masks.property(i).name.indexOf('__Gravedad_')===0)layer.property('ADBE Mask Parade').property(i).remove();}
 // Collision outline. Presets are measured by the effect; anything else is stored as constant masks.
 function applyGeometry(l,c,e,g,kind,stamp){var r=l.sourceRectAtTime(c.workAreaStart,false);if(r.width<=0||r.height<=0)throw Error(l.name+': la capa no tiene límites visibles.');if(r.width<.5||r.height<.5)throw Error(l.name+': es demasiado fina para colisionar (mínimo 0,5 px).');if(r.width>30000||r.height>30000)throw Error(l.name+': supera el tamaño máximo de 30000 px.');
  set(e,B.width,r.width);set(e,B.height,r.height);set(e,B.cx,r.left+r.width/2);set(e,B.cy,r.top+r.height/2);
  if(kind){removeStored(l);e=body(l);set(e,B.shape,kind);}else e=GravedadGeometry.store(l,g,e);
  // Stroke-only shapes are hollow; the wall is as thick as the stroke and follows it.
  if(!g.filled&&g.stroke>0)set(e,B.hollow,1);if(g.stroke>0)set(e,B.thickness,g.stroke);set(e,B.hash,hash(stamp));return e;}
 function geometry(l,c,e,stamp){validate(l);var g=GravedadGeometry.extract(l,c.workAreaStart);return applyGeometry(l,c,e,g,preset(l,c),stamp||geometryStamp(l,c.workAreaStart));}
 // Changed or duplicated-then-edited outlines are measured again; the fingerprint lives in the effect.
 // A failure is reported: a copy that keeps its original outline would collide where it is no longer drawn.
 function remeasure(c,l,e){var out={effect:e,changed:false,problem:null};if(e.property(B.mode).value===4)return out;
  if(!(l instanceof ShapeLayer||l.property('ADBE Text Properties')||e.property(B.shape).value!==3))return out;
  var stamp=geometryStamp(l,c.workAreaStart);if(hash(stamp)===e.property(B.hash).value)return out;
  app.beginUndoGroup('Gravedad · Actualizar forma');try{out.effect=geometry(l,c,e,stamp);out.changed=true;}catch(err){out.problem=l.name+': no se pudo actualizar el contorno. '+err.message;}finally{app.endUndoGroup();}return out;}
 function remember(c,list){compKeys[c.id]=compKey(c,list);}
 function select(c,layers){for(var i=1;i<=c.numLayers;i++)c.layer(i).selected=false;for(var j=0;j<layers.length;j++)layers[j].selected=true;}
 // Assigns a mode to layers; shared by the Dynamic, Fixed and Force buttons.
 function assign(c,layers,mode,rasters){
  for(var n=0;n<layers.length;n++){validate(layers[n]);if(mode===4&&!layers[n].nullLayer)throw Error('Fuerza se aplica a un nulo.');if(mode!==4&&layers[n].nullLayer)throw Error(layers[n].name+': un nulo solo puede ser Fuerza.');}
  ensureWorld(c);
  // Layers with identical outlines share one extraction, like instanced geometry.
  var prepared=[],stamps=[],kinds=[],cache={};
  for(var n=0;n<layers.length;n++){var l=layers[n];stamps.push(geometryStamp(l,c.workAreaStart));if(mode===4){prepared.push(null);kinds.push(0);continue;}var raster=rasters&&rasters[l.index],key=raster?null:(l instanceof ShapeLayer?'shape':(l.source?'source'+l.source.id:'layer'+l.id))+stamps[n];if(!key||!cache[key])cache[key||'raster'+n]={g:GravedadGeometry.extract(l,c.workAreaStart,raster),kind:raster?0:preset(l,c)};var shared=cache[key||'raster'+n];prepared.push(shared.g);kinds.push(shared.kind&&(shared.kind!==2||uniform(l))?shared.kind:0);}
  for(var i=0;i<layers.length;i++){var l=layers[i],e=body(l);if(!e){e=l.property('ADBE Effect Parade').addProperty(match);if(!e)throw Error('Instala Gravedad y reinicia After una vez.');}
   // First in the stack: shadows and other effects then follow the motion instead of turning with it.
   if(e.propertyIndex!==1){e.moveTo(1);e=body(l);}
   set(e,B.enabled,1);var m=mode;if(m===1&&animated(l))m=3;set(e,B.mode,m);
   if(mode!==4)e=applyGeometry(l,c,e,prepared[i],kinds[i],stamps[i]);
   delete bodySignatures[c.id+':'+l.id];}
  var list=all(c);refresh(c,list);remember(c,list);return summary(c,list);}
 return {
 prepare:function(raw){return wrap(function(){var c=comp(),data=JSON.parse(raw),layers=c.selectedLayers,rasters=[];for(var i=0;i<layers.length;i++){var l=layers[i];if(data.mode!==4&&!(l instanceof ShapeLayer)&&l.source&&l.source.file&&/\.png$/i.test(l.source.file.name))rasters.push({index:l.index,file:l.source.file.fsName});}return {rasters:rasters};});},
 // Earth and Space are presets of the world controller; the gravity value can then be changed on the solid.
 environment:function(raw){return wrap(function(){var c=comp(),value=JSON.parse(raw).value;if(value!==1&&value!==2)throw Error('Entorno inválido.');app.beginUndoGroup('Gravedad · Tierra / Espacio');try{var w=ensureWorld(c);set(w.effect,W.gravity,value===2?0:980);set(w.effect,W.environment,value);var list=all(c);refresh(c,list);return summary(c,list);}finally{app.endUndoGroup();}});},
 walls:function(raw){return wrap(function(){var c=comp(),value=JSON.parse(raw).value?1:0;app.beginUndoGroup('Gravedad · Paredes');try{var w=ensureWorld(c);set(w.effect,W.walls,value);var list=all(c);refresh(c,list);return summary(c,list);}finally{app.endUndoGroup();}});},
 inspect:function(){return wrap(function(){var c=comp(true);return summary(c,all(c));});},
 assign:function(raw){return wrap(function(){var data=JSON.parse(raw);if(data.mode!==1&&data.mode!==2&&data.mode!==3&&data.mode!==4)throw Error('Movimiento no válido.');var c=comp(),layers=data.index?[c.layer(data.index)]:c.selectedLayers;if(!layers.length)throw Error('Selecciona capas en el timeline.');
  app.beginUndoGroup('Gravedad · Asignar');try{return assign(c,layers,data.mode,data.rasters);}finally{app.endUndoGroup();}});},
 // Force: the selected nulls become fans; with none selected a ready-to-use fan pushing up is created.
 force:function(){return wrap(function(){var c=comp(),nulls=[];for(var i=0;i<c.selectedLayers.length;i++)if(c.selectedLayers[i].nullLayer)nulls.push(c.selectedLayers[i]);
  app.beginUndoGroup('Gravedad · Fuerza');try{if(!nulls.length){var n=c.layers.addNull();n.name='Ventilador';n.transform.position.setValue([c.width/2,c.height/2]);n.transform.rotation.setValue(180);nulls=[n];}
   var out=assign(c,nulls,4);select(c,nulls);out.created=nulls.length;return out;}finally{app.endUndoGroup();}});},
 // The apple: switches every body and emitter on or off; switching on creates the world controller if missing.
 toggle:function(raw){return wrap(function(){var c=comp(),enabled=JSON.parse(raw).enabled,list=all(c),em=emitters(c);app.beginUndoGroup('Gravedad · Activar o desactivar');try{if(enabled)ensureWorld(c);for(var i=0;i<list.length;i++){set(list[i].effect,B.enabled,enabled?1:0);if(enabled&&!list[i].effect.enabled)list[i].effect.enabled=true;}for(var i=0;i<em.length;i++)setOn(em[i],particlesMatch,P.enabled,enabled?1:0);
  var w=world(c);if(w&&w.effect.enabled!==!!enabled)w.effect.enabled=!!enabled;refresh(c,list);var out=summary(c,list);if(!list.length&&!em.length)out.active=!!enabled;return out;}finally{app.endUndoGroup();}});},
 // Incremental check within a time budget, resuming where the previous pass stopped,
 // so a scene with a thousand bodies never blocks After for long.
 sync:function(raw){return wrap(function(){var budget=raw?JSON.parse(raw).budget||60:60,deadline=new Date().getTime()+budget,c=comp(true),list=all(c),changed=false,key=compKey(c,list);
  if(compKeys[c.id]!==undefined&&compKeys[c.id]!==key)changed=true;compKeys[c.id]=key;
  var count=list.length,from=cursors[c.id]||0,done=0,problems=[];
  for(;done<count;done++){var item=list[(from+done)%count],l=item.layer,e=item.effect,id=c.id+':'+l.id,mode=e.property(B.mode).value;
   if(mode!==4){
    if(mode===1&&animated(l)){app.beginUndoGroup('Gravedad · Fijo animado');try{e.property(B.mode).setValue(3);}finally{app.endUndoGroup();}}
    var r=remeasure(c,l,e);e=r.effect;if(r.changed)changed=true;if(r.problem)problems.push(r.problem);}
   var s=bodySignature(l,e,c);if(bodySignatures[id]!==undefined&&bodySignatures[id]!==s)changed=true;bodySignatures[id]=s;
   if(new Date().getTime()>deadline){done++;break;}}
  cursors[c.id]=count?(from+done)%count:0;
  if(changed){app.beginUndoGroup('Gravedad · Actualizar escena');try{refresh(c,list);}finally{app.endUndoGroup();}}var out=summary(c,list);out.checked=done;out.changed=changed;if(problems.length)out.problem=problems[0];return out;});},
 // Bake: stamp the world controller (and emitters) and render the last frame; the effects then simulate every frame once and store it on disk.
 bake:function(){return wrap(function(){var c=comp(),list=all(c),em=emitters(c);if(!list.length&&!em.length)throw Error('Asigna cuerpos o crea partículas antes de hornear.');
  // Every outline is brought up to date first: a bake must never keep a copy's old collision shape.
  for(var i=0;i<list.length;i++){var r=remeasure(c,list[i].layer,list[i].effect);if(r.problem)throw Error(r.problem);}
  var stamp=Math.floor(new Date().getTime()/1000),w;app.beginUndoGroup('Gravedad · Hornear');try{w=ensureWorld(c);list=all(c);refresh(c,list);set(w.effect,W.bake,stamp);for(var i=0;i<em.length;i++)setOn(em[i],particlesMatch,P.bake,stamp);}finally{app.endUndoGroup();}
  w=world(c);var last=w.effect.property(W.start).value+w.effect.property(W.duration).value-1/c.frameRate,target=new File(Folder.temp.fsName+'/gravedad-horneado-'+c.id+'.png');c.saveFrameToPng(Math.max(0,last),target);var out=summary(c,list);out.baking=true;return out;});},
 baked:function(){return wrap(function(){purge();var c=comp(true);return summary(c,all(c));});},
 // Particles: a null emits copies of a shape layer. Whatever is not selected is created, so one click always shows an example.
 // A locked render layer draws every particle, because After never renders null layers.
 particles:function(){return wrap(function(){var c=comp(),sel=c.selectedLayers,emitter=null,ref=null;
  for(var i=0;i<sel.length;i++){if(sel[i].nullLayer){if(!emitter)emitter=sel[i];}else if(!ref&&!effectOf(sel[i],particlesMatch))ref=sel[i];}
  app.beginUndoGroup('Gravedad · Partículas');try{
   ensureWorld(c);
   if(!ref){ref=c.layers.addShape();ref.name='Forma de partícula';ref.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');var g=ref.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group');g.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue([36,36]);g.addProperty('ADBE Vector Graphic - Fill');ref.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(2).property('ADBE Vector Fill Color').setValue([1,.53,.61]);ref.transform.position.setValue([c.width/2,c.height/2]);}
   if(!emitter){emitter=c.layers.addNull();emitter.name='Emisor de partículas';emitter.transform.position.setValue([c.width/2,c.height*.15]);}
   if(ref.threeDLayer||emitter.threeDLayer)throw Error('Usa capas 2D para el emisor y la forma.');if(emitter.parent)throw Error(emitter.name+': el nulo emisor no puede tener padre.');
   var r=ref.sourceRectAtTime(c.workAreaStart,false);if(r.width<=0||r.height<=0)throw Error(ref.name+': la capa no tiene contenido visible.');
   var solid=c.layers.addSolid([1,1,1],'Gravedad · Partículas · '+emitter.name,c.width,c.height,c.pixelAspect,c.duration);if(!solid.property('ADBE Effect Parade').addProperty(particlesMatch)){solid.remove();throw Error('Instala Gravedad 0.6 y reinicia After una vez.');}
   function p(i){return effectOf(solid,particlesMatch).property(i);}
   p(P.layer).setValue(ref.index);p(P.emitter).setValue(emitter.index);p(P.rate).setValue(40);p(P.max).setValue(250);p(P.width).setValue(Math.round(Math.min(c.width*.4,400)));p(P.spread).setValue(40);p(P.radius).setValue(Math.max(.5,Math.min(r.width,r.height)/2));
   ref.enabled=false;solid.locked=true;select(c,[emitter]);
   var list=all(c);refresh(c,list);var out=summary(c,list);out.active=true;return out;}finally{app.endUndoGroup();}});},
 refresh:function(){return wrap(function(){var c=comp(),list=all(c);app.beginUndoGroup('Gravedad · Actualizar geometría');try{for(var i=0;i<list.length;i++)if(list[i].effect.property(B.mode).value!==4)geometry(list[i].layer,c,list[i].effect);list=all(c);refresh(c,list);return summary(c,list);}finally{app.endUndoGroup();}});}
 };
}());
