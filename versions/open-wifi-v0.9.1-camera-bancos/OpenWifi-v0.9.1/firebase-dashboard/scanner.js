const LOCAL_JOIN='http://10.77.0.254:8080/join.html';
const video=document.querySelector('#camera'),msg=document.querySelector('#scannerMsg'),btn=document.querySelector('#startCamera'),input=document.querySelector('#photoInput');
let stream=null,running=false,scanDetector=null;

function stopCamera(){
  running=false;
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
}

function acceptValue(raw){
  raw=String(raw||'').trim();
  if(!raw)return false;
  if(/^https?:\/\//i.test(raw)){
    try{
      const u=new URL(raw);
      if(u.pathname.toLowerCase().includes('join')){location.href=raw;return true;}
    }catch{}
  }
  const code=raw.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length===8){
    location.href=`${LOCAL_JOIN}?code=${encodeURIComponent(code.slice(0,4)+'-'+code.slice(4))}`;
    return true;
  }
  return false;
}

async function createDetector(){
  if(!('BarcodeDetector' in window)) return null;
  try{
    const formats=await BarcodeDetector.getSupportedFormats();
    if(!formats.includes('qr_code')) return null;
    return new BarcodeDetector({formats:['qr_code']});
  }catch{return null;}
}

async function requestCamera(){
  if(!isSecureContext) throw new Error('A câmera exige HTTPS. Abra este scanner pelo endereço do Firebase Hosting.');
  if(!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não disponibilizou acesso à câmera. Tente abrir o scanner no Chrome/Safari completo.');
  // A chamada abaixo é propositalmente feita ANTES do leitor QR. É ela que dispara
  // a solicitação de permissão do navegador para a câmera.
  return navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
}

async function start(){
  if(running)return;
  btn.disabled=true;
  msg.textContent='Solicitando permissão para usar a câmera…';
  try{
    stream=await requestCamera();
    video.srcObject=stream;
    await video.play();
    running=true;
    btn.textContent='Câmera ativa ✓';
    msg.textContent='Câmera liberada. Procurando um QR de convite…';

    scanDetector=await createDetector();
    if(!scanDetector){
      msg.textContent='A câmera foi liberada, mas este navegador não possui leitor QR ao vivo. Use “Usar uma foto do QR”, abra no Chrome/Safari completo ou digite o código.';
      return;
    }

    const loop=async()=>{
      if(!running)return;
      try{
        const codes=await scanDetector.detect(video);
        for(const c of codes){
          if(acceptValue(c.rawValue)){stopCamera();return;}
        }
      }catch{}
      requestAnimationFrame(loop);
    };
    loop();
  }catch(e){
    stopCamera();
    const name=e?.name||'';
    if(name==='NotAllowedError') msg.textContent='Permissão da câmera negada. Autorize a câmera para este site nas permissões do navegador e tente novamente.';
    else if(name==='NotFoundError') msg.textContent='Não encontrei uma câmera disponível neste aparelho.';
    else if(name==='NotReadableError') msg.textContent='A câmera está ocupada por outro aplicativo. Feche-o e tente novamente.';
    else msg.textContent=e?.message||'Não foi possível abrir a câmera.';
    btn.disabled=false;
    btn.textContent='Tentar permitir câmera novamente';
  }
}

btn.addEventListener('click',start);

input.addEventListener('change',async()=>{
  const file=input.files?.[0];
  if(!file)return;
  try{
    const d=await createDetector();
    if(!d)throw new Error('Seu navegador não oferece leitura QR de imagens. Abra no Chrome/Safari completo ou digite o código do convite.');
    const bmp=await createImageBitmap(file);
    const codes=await d.detect(bmp);
    if(!codes.some(c=>acceptValue(c.rawValue)))msg.textContent='Não encontrei um QR de convite nessa imagem.';
  }catch(e){msg.textContent=e.message;}
});

window.addEventListener('pagehide',stopCamera);
