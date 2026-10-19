// WhatsApp click-to-chat supports a recipient and text, never file attachments.
export function whatsAppTicketUrl(phone, { link, eventTitle = "Etkinlik" }) {
  let digits = "";
  if (typeof phone === "string" && /^[+\d\s().-]+$/.test(phone.trim())) {
    digits = phone.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (/^0\d{10}$/.test(digits)) digits = `90${digits.slice(1)}`;
    else if (/^5\d{9}$/.test(digits)) digits = `90${digits}`;
    if (!/^[1-9]\d{7,14}$/.test(digits)) digits = "";
  }
  const url = new URL(`https://wa.me/${digits}`);
  url.searchParams.set("text", `${eventTitle} için kişisel biletin hazır. Bağlantıyı açıp giriş yapmadan görüntüleyebilir, fotoğraf veya PDF olarak indirebilirsin. Etkinlik girişinde QR kodunu göstermen yeterli.\n\n*Çekilişlere katılmak ve farklı ayrıcalıklardan yararlanmak için biletini hesabına ekle.*\nBilet sayfasındaki “Biletimi hesabıma ekle” düğmesine dokunabilirsin.\n\n${link}`);
  return url.href;
}
