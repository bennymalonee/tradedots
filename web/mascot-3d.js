// Render rounded, textured mascot volumes, rather than rotating flat image planes.
(() => {
  const vertex = `attribute vec2 position; varying vec2 uv;
    void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision highp float;
    varying vec2 uv; uniform sampler2D sprites; uniform float cell, angle;
    uniform vec3 bodyColor;
    const float aspect=724./543.;
    vec4 artwork(vec3 p){
      vec2 t=vec2(p.x+.5,.5-p.y/aspect);
      if(t.x<0.||t.x>1.||t.y<0.||t.y>1.)return vec4(0.);
      return texture2D(sprites,vec2((cell+t.x)/4.,t.y));
    }
    float depth(vec3 p){
      float roundX=sqrt(max(.05,1.-pow(p.x/.54,2.)));
      float roundY=sqrt(max(.12,1.-pow((p.y+.12)/.8,2.)));
      return .23*roundX*roundY;
    }
    float field(vec3 p){
      if(artwork(p).a<.5)return .08;
      return abs(p.z)-depth(p);
    }
    vec3 turn(vec3 p){float c=cos(angle),s=sin(angle);
      return vec3(c*p.x-s*p.z,p.y,s*p.x+c*p.z);}
    void main(){
      vec3 origin=turn(vec3(uv.x-.5,(uv.y-.5)*aspect,1.1));
      vec3 ray=turn(vec3(0.,0.,-1.));
      vec3 p=origin; bool hit=false;
      for(int i=0;i<116;i++){
        p=origin+ray*(float(i)*.019);
        if(field(p)<0.){hit=true;break;}
      }
      if(!hit){gl_FragColor=vec4(0.);return;}
      float e=.008;
      vec3 normal=normalize(vec3(
        field(p+vec3(e,0.,0.))-field(p-vec3(e,0.,0.)),
        field(p+vec3(0.,e,0.))-field(p-vec3(0.,e,0.)),
        field(p+vec3(0.,0.,e))-field(p-vec3(0.,0.,e)))+vec3(.00001));
      vec4 tex=artwork(p);
      float grain=fract(sin(dot(p.xy,vec2(123.4,456.7)))*43758.5);
      vec3 back=bodyColor*(.88+.16*grain);
      // Keep the knit hat dark on every side of the blue mascot.
      if(cell<.5&&p.y>.22&&max(tex.r,max(tex.g,tex.b))<.4)back=tex.rgb;
      vec3 color=mix(back,tex.rgb,smoothstep(.01,.12,p.z));
      vec3 light=normalize(turn(vec3(-.5,.8,1.)));
      float diffuse=.66+.34*max(0.,dot(normal,light));
      float rim=pow(1.-abs(dot(normal,-ray)),3.)*.12;
      gl_FragColor=vec4(color*diffuse+vec3(1.,.86,.5)*rim,1.);
    }`;
  const colors = [[.02,.56,1.],[.53,.86,.02],[1.,.69,.015],[1.,.025,.66]];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const image = new Image(); image.src = '/characters.png';
  image.onload = () => {
    const models = [];
    document.querySelectorAll('.mascot-tile').forEach((tile, index) => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const gl = canvas.getContext('webgl', {alpha:true, antialias:true, premultipliedAlpha:false});
      if (!gl) return;
      try {
        const shader = (type, source) => {
          const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Shader unavailable');
          return s;
        };
        const program=gl.createProgram();
        gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));
        gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Renderer unavailable');
        gl.useProgram(program);
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        const position=gl.getAttribLocation(program,'position');
        gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        gl.uniform1i(gl.getUniformLocation(program,'sprites'),0);
        gl.uniform1f(gl.getUniformLocation(program,'cell'),index);
        gl.uniform3fv(gl.getUniformLocation(program,'bodyColor'),colors[index]);
        const model={tile,canvas,gl,angle:0,dirty:true,visible:true,angleUniform:gl.getUniformLocation(program,'angle')};
        const resize=()=>{
          canvas.width=Math.max(160,Math.min(384,Math.round(tile.clientWidth*Math.min(devicePixelRatio,1.5))));
          canvas.height=Math.round(canvas.width*724/543);
          gl.viewport(0,0,canvas.width,canvas.height);model.dirty=true;
        };
        tile.append(canvas);resize();tile.classList.add('volume-ready');
        new ResizeObserver(resize).observe(tile);
        new MutationObserver(()=>{model.dirty=true}).observe(tile,{attributes:true,attributeFilter:['data-state','data-busy']});
        new IntersectionObserver(entries=>{model.visible=entries[0].isIntersecting;model.dirty=true}).observe(tile);
        canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();tile.classList.remove('volume-ready');model.visible=false});
        models.push(model);
      } catch { canvas.remove(); }
    });
    let previous=0;
    function frame(now){
      requestAnimationFrame(frame);
      if(now-previous<33)return;
      const dt=Math.min((now-previous)/1000,.1);previous=now;
      if(document.hidden)return;
      const paused=document.querySelector('.terminal')?.classList.contains('sim-paused');
      for(const m of models){
        if(!m.visible)continue;
        const working=m.tile.dataset.busy==='true'&&!reduced.matches;
        if(working&&!paused){m.angle=(m.angle+dt*Math.PI*2/2.4)%(Math.PI*2);m.dirty=true;}
        if(!working&&m.angle!==0){m.angle=0;m.dirty=true;}
        if(m.dirty){m.gl.uniform1f(m.angleUniform,m.angle);m.gl.drawArrays(m.gl.TRIANGLES,0,6);m.dirty=false;}
      }
    }
    requestAnimationFrame(frame);
  };
})();
