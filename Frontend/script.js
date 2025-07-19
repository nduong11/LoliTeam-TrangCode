// Tab switching
const tabSample = document.getElementById('tab-sample');
const tabUser = document.getElementById('tab-user');
const sampleSection = document.getElementById('sample-section');
const userSection = document.getElementById('user-section');

tabSample.onclick = () => {
  tabSample.classList.add('active');
  tabUser.classList.remove('active');
  sampleSection.style.display = '';
  userSection.style.display = 'none';
};
tabUser.onclick = () => {
  tabUser.classList.add('active');
  tabSample.classList.remove('active');
  userSection.style.display = '';
  sampleSection.style.display = 'none';
};

// Analyze user input
const userForm = document.getElementById('user-form');
const userResult = document.getElementById('user-result');
userForm.onsubmit = async (e) => {
  e.preventDefault();
  userResult.textContent = 'Đang phân tích...';
  const email = document.getElementById('user-email').value.trim();
  const content = document.getElementById('user-content').value.trim();
  try {
    const res = await fetch('https://loli-team-be.btecit.tech/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, content })
    });
    if (!res.ok) throw new Error('Không phân tích được');
    const data = await res.json();
    let html = `<b>Phân tích:</b>\n${data.explanation}\n\n<b>Kết luận:</b> ${data.verdict}`;
    userResult.innerHTML = html.replace(/\n/g, '<br>');
  } catch (err) {
    userResult.textContent = 'Lỗi: ' + err.message;
  }
};

const randomBtn = document.getElementById('random-btn');
randomBtn.onclick = async () => {
  const sampleResult = document.getElementById('sample-result');
  sampleResult.textContent = 'Đang lấy dữ liệu ngẫu nhiên...';
  const table = 'incoming_emails';
  try {
    const res = await fetch(`https://loli-team-be.btecit.tech/data/${table}/-1`);
    if (!res.ok) throw new Error('Không lấy được dữ liệu');
    const data = await res.json();
    if (!data.data) {
      sampleResult.textContent = 'Không tìm thấy bản ghi.';
      return;
    }
    // Trình bày dữ liệu giống email
    const emailData = data.data;
    let html = `<div class='email-view'>`;
    if(emailData.from_email) html += `<div class='email-from'><b>From:</b> ${emailData.from_email}</div>`;
    if(emailData.to_email) html += `<div class='email-to'><b>To:</b> ${emailData.to_email}</div>`;
    if(emailData.subject) html += `<div class='email-subject'><b>Subject:</b> ${emailData.subject}</div>`;
    if(emailData.content) html += `<div class='email-content'>${emailData.content}</div>`;
    html += `</div>`;
    html += `<div class='email-analysis'><b>Phân tích:</b><br>${data.analysis.explanation.replace(/\n/g, '<br>')}<br><br><b>Kết luận:</b> ${data.analysis.verdict}</div>`;
    sampleResult.innerHTML = html;
  } catch (err) {
    sampleResult.textContent = 'Lỗi: ' + err.message;
  }
};

const sampleForm = document.getElementById('sample-form');
sampleForm.onsubmit = (e) => e.preventDefault(); 