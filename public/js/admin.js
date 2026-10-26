// 管理员后台
async function loadAdmin() {
  await loadUsers();
  await loadSettings();
}

async function loadUsers() {
  try {
    const data = await api('/admin/users');
    const tbody = document.getElementById('adminUsersBody');
    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.nickname || ''}</td>
        <td><input type="checkbox" ${u.card_counter_enabled ? 'checked' : ''} data-id="${u.id}" data-field="card_counter_enabled"></td>
        <td><input type="checkbox" ${u.sound_enabled ? 'checked' : ''} data-id="${u.id}" data-field="sound_enabled"></td>
        <td><input type="checkbox" ${u.music_enabled ? 'checked' : ''} data-id="${u.id}" data-field="music_enabled"></td>
        <td><input type="checkbox" ${u.is_admin ? 'checked' : ''} data-id="${u.id}" data-field="is_admin" ${u.id === 1 ? 'disabled' : ''}></td>
        <td>${u.wins}/${u.losses}</td>
        <td><button class="btn-mini" data-del="${u.id}" ${u.id === 1 ? 'disabled' : ''}>删除</button></td>
      </tr>
    `).join('');

    // 绑定 checkbox 变更
    tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = parseInt(cb.dataset.id);
        const field = cb.dataset.field;
        const value = cb.checked;
        try {
          await api(`/admin/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ [field]: value })
          });
        } catch (e) { alert(e.message); cb.checked = !value; }
      });
    });

    // 删除按钮
    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.del);
        if (!confirm('确定删除该用户？')) return;
        try {
          await api(`/admin/users/${id}`, { method: 'DELETE' });
          loadUsers();
        } catch (e) { alert(e.message); }
      });
    });
  } catch (e) {
    alert('加载用户失败：' + e.message);
  }
}

async function loadSettings() {
  try {
    const data = await api('/admin/settings');
    const s = data.settings;
    document.getElementById('setGlobalSound').checked = s.global_sound_enabled === '1';
    document.getElementById('setGlobalMusic').checked = s.global_music_enabled === '1';
    document.getElementById('setGlobalCounter').checked = s.global_card_counter === '1';
    document.getElementById('setSoundVolume').value = parseFloat(s.sound_volume || 0.6);
    document.getElementById('setMusicVolume').value = parseFloat(s.music_volume || 0.3);
  } catch (e) {
    alert('加载设置失败：' + e.message);
  }
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const settings = {
    global_sound_enabled: document.getElementById('setGlobalSound').checked ? '1' : '0',
    global_music_enabled: document.getElementById('setGlobalMusic').checked ? '1' : '0',
    global_card_counter: document.getElementById('setGlobalCounter').checked ? '1' : '0',
    sound_volume: document.getElementById('setSoundVolume').value,
    music_volume: document.getElementById('setMusicVolume').value
  };
  try {
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) });
    alert('设置已保存');
    SoundManager.setPrefs({
      sVol: parseFloat(settings.sound_volume),
      mVol: parseFloat(settings.music_volume)
    });
  } catch (e) {
    alert('保存失败：' + e.message);
  }
});
