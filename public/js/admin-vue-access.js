(() => {
  if (!window.Vue) return;
  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  const roleTypeName = type => type === 'platform' ? '后台角色' : '前台角色';
  const userTypeName = type => type === 'platform' ? '后台用户' : '前台用户';

  async function apiJson(url, opts = {}) {
    return api.request(url, opts);
  }

  function moduleActions(matrix, module) {
    const fallback = (matrix?.actions || []).map(a => a.id);
    return new Set(Array.isArray(module.actions) && module.actions.length ? module.actions : fallback);
  }

  function flattenPermissionKeys(matrix, type, mode = 'menu') {
    const keys = [];
    (matrix?.modules || []).forEach(module => {
      const actions = moduleActions(matrix, module);
      (matrix.actions || []).forEach(action => {
        if (!actions.has(action.id)) return;
        const isListAction = ['export'].includes(action.id);
        if (mode === 'list' && !isListAction) return;
        if (mode === 'menu' && isListAction) return;
        keys.push(`${type}:${module.id}:${action.id}`);
      });
    });
    return keys;
  }

  function buildMenuTree(matrix, type, selected) {
    const groups = [];
    const groupMap = new Map();
    (matrix?.modules || []).forEach(module => {
      const groupName = module.group || '未分组';
      if (!groupMap.has(groupName)) {
        const group = { id: `g:${groupName}`, label: groupName, children: [] };
        groupMap.set(groupName, group);
        groups.push(group);
      }
      const actions = moduleActions(matrix, module);
      const children = (matrix.actions || [])
        .filter(action => actions.has(action.id) && action.id !== 'export')
        .map(action => ({
          id: `${type}:${module.id}:${action.id}`,
          key: `${type}:${module.id}:${action.id}`,
          label: action.id === 'view' ? '查看/菜单' : action.label
        }));
      groupMap.get(groupName).children.push({
        id: `m:${module.id}`,
        label: module.label,
        moduleId: module.id,
        children,
        checked: children.length && children.every(child => selected.has(child.key))
      });
    });
    return groups;
  }

  function listSections(matrix, type) {
    return (matrix?.modules || []).map(module => {
      const actions = moduleActions(matrix, module);
      const columns = (matrix.actions || [])
        .filter(action => actions.has(action.id) && action.id === 'export')
        .map(action => ({ id: `${type}:${module.id}:${action.id}`, label: action.label || '导出' }));
      return columns.length ? { title: module.label, columns } : null;
    }).filter(Boolean);
  }

  function dateText(value) {
    return value ? new Date(value).toLocaleString('zh-CN') : '-';
  }

  createApp({
    data() {
      return {
        users: [],
        roles: [],
        loading: false,
        tab: 'enterprise',
        query: '',
        status: '',
        showModal: false,
        showPassword: false,
        form: this.emptyForm()
      };
    },
    computed: {
      typeRoles() {
        return this.roles.filter(role => (role.type || 'enterprise') === this.tab);
      },
      filteredUsers() {
        const q = this.query.trim().toLowerCase();
        return this.users.filter(user => {
          const role = this.roles.find(item => item.id === user.role);
          const type = role ? (role.type || 'enterprise') : 'enterprise';
          if (type !== this.tab) return false;
          if (this.status && (user.status || 'active') !== this.status) return false;
          if (!q) return true;
          return [user.username, user.nickname, user.phone, user.email]
            .some(value => String(value || '').toLowerCase().includes(q));
        });
      },
      tabUserCount() {
        return this.users.filter(user => this.userRoleType(user) === this.tab).length;
      },
      platformUserCount() {
        return this.users.filter(user => this.userRoleType(user) === 'platform').length;
      },
      enterpriseUserCount() {
        return this.users.filter(user => this.userRoleType(user) === 'enterprise').length;
      },
      userScopeText() {
        return `当前 ${this.filteredUsers.length} / 本类 ${this.tabUserCount} / 全部 ${this.users.length}，前台 ${this.enterpriseUserCount}，后台 ${this.platformUserCount}`;
      }
    },
    methods: {
      emptyForm() {
        return {
          username: '',
          password: '',
          nickname: '',
          role: '',
          phone: '',
          email: '',
          gender: '',
          remark: '',
          status: 'active'
        };
      },
      async refresh() {
        this.loading = true;
        try {
          const [users, roles] = await Promise.all([
            apiJson('/api/admin/users'),
            apiJson('/api/admin/roles')
          ]);
          this.users = users || [];
          this.roles = roles || [];
          if (!this.form.role) this.form.role = this.typeRoles[0]?.id || '';
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          this.loading = false;
        }
      },
      switchTab(type) {
        this.tab = type;
        this.form.role = this.typeRoles[0]?.id || '';
      },
      resetFilters() {
        this.query = '';
        this.status = '';
      },
      roleLabel(id) {
        const role = this.roles.find(item => item.id === id);
        return role ? (role.label || role.id) : id;
      },
      userRoleType(user) {
        const role = this.roles.find(item => item.id === user.role);
        return role ? (role.type || 'enterprise') : 'enterprise';
      },
      openAdd() {
        this.form = this.emptyForm();
        this.form.role = this.typeRoles[0]?.id || '';
        this.showPassword = false;
        this.showModal = true;
      },
      async createUser() {
        if (!this.form.username || !this.form.password) return toast('用户名和密码必填', 'error');
        if (this.form.password.length < 6) return toast('密码至少 6 位', 'error');
        if (!this.form.role) return toast('请选择角色', 'error');
        try {
          await apiJson('/api/admin/users', { method: 'POST', body: JSON.stringify(this.form) });
          toast('用户已创建');
          this.showModal = false;
          await this.refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      async toggleStatus(user) {
        const next = (user.status || 'active') === 'active' ? 'disabled' : 'active';
        try {
          await apiJson(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
          user.status = next;
          toast('状态已更新');
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      async resetPassword(user) {
        const password = prompt(`为 ${user.username} 设置新密码（至少 6 位）`);
        if (!password) return;
        if (password.length < 6) return toast('密码至少 6 位', 'error');
        try {
          await apiJson(`/api/admin/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
          toast('密码已重置');
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      async removeUser(user) {
        if (!confirm(`确定删除用户 "${user.username}"？`)) return;
        try {
          await apiJson(`/api/admin/users/${user.id}`, { method: 'DELETE' });
          toast('用户已删除');
          await this.refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      userTypeName,
      dateText
    },
    mounted() { this.refresh(); },
    template: `
      <section class="vue-admin-page">
        <div class="vue-tabs">
          <button :class="{active:tab==='enterprise'}" @click="switchTab('enterprise')">前台用户</button>
          <button :class="{active:tab==='platform'}" @click="switchTab('platform')">后台用户</button>
          <span class="vue-tab-summary">{{ userScopeText }}</span>
        </div>
        <div class="vue-access-card">
          <div class="vue-toolbar">
            <input v-model="query" placeholder="请输入用户名/手机号" />
            <select v-model="status">
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">停用</option>
            </select>
            <button class="vue-btn primary" @click="refresh">查询</button>
            <button class="vue-btn" @click="resetFilters">重置</button>
            <span class="vue-spacer"></span>
            <button class="vue-btn primary" @click="openAdd">添加</button>
            <button class="vue-btn" @click="refresh">刷新缓存</button>
          </div>
          <table class="vue-table">
            <thead>
              <tr>
                <th><input type="checkbox" disabled /></th>
                <th>用户名称</th>
                <th>用户昵称</th>
                <th>手机号码</th>
                <th>角色</th>
                <th>创建时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in filteredUsers" :key="user.id">
                <td><input type="checkbox" /></td>
                <td>{{ user.username }}</td>
                <td>{{ user.nickname || user.username }}</td>
                <td>{{ user.phone || '-' }}</td>
                <td>{{ roleLabel(user.role) }}</td>
                <td>{{ dateText(user.created_at) }}</td>
                <td><button class="vue-switch" :class="{on:(user.status || 'active')==='active'}" @click="toggleStatus(user)"><i></i></button></td>
                <td class="vue-actions">
                  <button @click="resetPassword(user)">重置密码</button>
                  <button @click="removeUser(user)">删除</button>
                </td>
              </tr>
              <tr v-if="!filteredUsers.length"><td colspan="8" class="vue-empty">{{ loading ? '加载中...' : '暂无用户' }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="vue-modal-mask" v-if="showModal" @click.self="showModal=false">
          <div class="vue-modal user-create-modal">
            <div class="vue-modal-head"><b>添加用户</b><button @click="showModal=false">×</button></div>
            <div class="vue-form-grid">
              <label class="required"><span>用户名</span><input v-model.trim="form.username" autocomplete="off" placeholder="用户名将只输入字母" /></label>
              <label class="required"><span>用户密码</span><span class="vue-password"><input v-model="form.password" :type="showPassword?'text':'password'" autocomplete="new-password" placeholder="请输入用户密码" /><button class="vue-password-toggle" type="button" @click.prevent="showPassword=!showPassword">{{ showPassword ? '隐藏' : '查看' }}</button></span></label>
              <label class="required"><span>用户昵称</span><input v-model.trim="form.nickname" placeholder="请输入用户昵称" /></label>
              <label class="required"><span>角色</span><select v-model="form.role"><option value="">请选择角色</option><option v-for="role in typeRoles" :key="role.id" :value="role.id">{{ role.label || role.id }}</option></select></label>
              <label><span>手机号码</span><input v-model.trim="form.phone" placeholder="请输入手机号码" /></label>
              <label><span>邮箱</span><input v-model.trim="form.email" placeholder="请输入邮箱" /></label>
              <label><span>用户性别</span><select v-model="form.gender"><option value="">请选择性别</option><option value="male">男</option><option value="female">女</option><option value="unknown">未知</option></select></label>
              <label class="wide"><span>备注</span><textarea v-model.trim="form.remark" placeholder="请输入内容"></textarea></label>
            </div>
            <div class="vue-modal-foot"><button class="vue-btn" @click="showModal=false">取消</button><button class="vue-btn primary" @click="createUser">确定</button></div>
          </div>
        </div>
      </section>`
  }).mount('#admin-users-vue');

  createApp({
    data() {
      return {
        roles: [],
        matrix: null,
        tab: 'platform',
        query: '',
        status: '',
        showRole: false,
        showList: false,
        editingId: null,
        expanded: new Set(),
        selected: new Set(),
        listSelected: new Set(),
        form: this.emptyRole()
      };
    },
    computed: {
      filteredRoles() {
        const q = this.query.trim().toLowerCase();
        return this.roles.filter(role => {
          if ((role.type || 'enterprise') !== this.tab) return false;
          if (this.status && (role.status || 'active') !== this.status) return false;
          if (!q) return true;
          return [role.id, role.label, role.remark, role.description]
            .some(value => String(value || '').toLowerCase().includes(q));
        }).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      },
      activeMatrix() {
        return this.matrix?.[this.form.type || this.tab] || null;
      },
      menuTree() {
        return buildMenuTree(this.activeMatrix, this.form.type || this.tab, this.selected);
      },
      listAuthSections() {
        return listSections(this.activeMatrix, this.form.type || this.tab);
      },
      allMenuExpanded() {
        const ids = [];
        this.menuTree.forEach(group => {
          ids.push(group.id);
          group.children.forEach(module => ids.push(module.id));
        });
        return ids.length > 0 && ids.every(id => this.expanded.has(id));
      },
      allMenuSelected() {
        const keys = flattenPermissionKeys(this.activeMatrix, this.form.type, 'menu');
        return keys.length > 0 && keys.every(key => this.selected.has(key));
      }
    },
    methods: {
      emptyRole() {
        return {
          id: '',
          label: '',
          type: this?.tab || 'platform',
          display_order: 0,
          status: 'active',
          remark: '',
          description: '',
          default_credits: 100,
          max_projects: 10,
          allowed_models: []
        };
      },
      async refresh() {
        try {
          const [roles, matrix] = await Promise.all([
            apiJson('/api/admin/roles'),
            apiJson('/api/admin/permissions-matrix')
          ]);
          this.roles = roles || [];
          this.matrix = matrix || {};
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      switchTab(type) {
        this.tab = type;
      },
      resetFilters() {
        this.query = '';
        this.status = '';
      },
      nextRoleId(type) {
        const prefix = (type === 'platform' ? 'platform' : 'enterprise') + '_role_';
        const nums = this.roles.map(role => String(role.id || '').startsWith(prefix) ? Number(String(role.id).slice(prefix.length)) : 0);
        return prefix + String(Math.max(0, ...nums) + 1).padStart(3, '0');
      },
      rolePermissions(role) {
        const type = role?.type || this.form.type || this.tab;
        const matrix = this.matrix?.[type];
        if (role?.permissions?.includes('*')) return flattenPermissionKeys(matrix, type, 'menu').concat(flattenPermissionKeys(matrix, type, 'list'));
        return role?.permissions || flattenPermissionKeys(matrix, type, 'menu').concat(flattenPermissionKeys(matrix, type, 'list'));
      },
      openRole(role) {
        this.editingId = role?.id || null;
        this.form = role
          ? { ...role, remark: role.remark || role.description || '', display_order: role.display_order || 0, status: role.status || 'active' }
          : { ...this.emptyRole(), type: this.tab, id: this.nextRoleId(this.tab) };
        const permissions = this.rolePermissions(role || this.form);
        this.selected = new Set(permissions.filter(key => !key.endsWith(':export')));
        this.listSelected = new Set(permissions.filter(key => key.endsWith(':export')));
        this.expandGroups();
        this.showRole = true;
      },
      openList(role) {
        this.editingId = role.id;
        this.form = { ...role, remark: role.remark || role.description || '', display_order: role.display_order || 0, status: role.status || 'active' };
        const permissions = this.rolePermissions(role);
        this.selected = new Set(permissions.filter(key => !key.endsWith(':export')));
        this.listSelected = new Set(permissions.filter(key => key.endsWith(':export')));
        this.showList = true;
      },
      treeKeys(node) {
        if (node.key) return [node.key];
        return (node.children || []).flatMap(child => this.treeKeys(child)).filter(Boolean);
      },
      toggleExpand(id) {
        const next = new Set(this.expanded);
        next.has(id) ? next.delete(id) : next.add(id);
        this.expanded = next;
      },
      expandAll() {
        const ids = [];
        this.menuTree.forEach(group => {
          ids.push(group.id);
          group.children.forEach(module => ids.push(module.id));
        });
        this.expanded = new Set(ids);
      },
      expandGroups() {
        this.expanded = new Set(this.menuTree.map(group => group.id));
      },
      collapseAll() {
        this.expanded = new Set();
      },
      toggleAllExpanded() {
        this.allMenuExpanded ? this.collapseAll() : this.expandAll();
      },
      isNodeChecked(node) {
        const keys = this.treeKeys(node);
        return keys.length && keys.every(key => this.selected.has(key));
      },
      toggleNode(node, checked) {
        const next = new Set(this.selected);
        this.treeKeys(node).forEach(key => checked ? next.add(key) : next.delete(key));
        this.selected = next;
      },
      setAllMenu(checked) {
        this.selected = checked ? new Set(flattenPermissionKeys(this.activeMatrix, this.form.type, 'menu')) : new Set();
      },
      toggleAllMenuSelected() {
        this.setAllMenu(!this.allMenuSelected);
      },
      setAllList(checked) {
        this.listSelected = checked ? new Set(flattenPermissionKeys(this.activeMatrix, this.form.type, 'list')) : new Set();
      },
      toggleList(key, checked) {
        const next = new Set(this.listSelected);
        checked ? next.add(key) : next.delete(key);
        this.listSelected = next;
      },
      async toggleRoleStatus(role) {
        const next = (role.status || 'active') === 'active' ? 'disabled' : 'active';
        try {
          await apiJson(`/api/admin/roles/${role.id}`, { method: 'PUT', body: JSON.stringify({ ...role, status: next }) });
          role.status = next;
          toast('状态已更新');
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      async saveRole() {
        if (!this.form.id || !this.form.label) return toast('角色编码和角色名称必填', 'error');
        const permissions = [...this.selected, ...this.listSelected];
        const body = { ...this.form, description: this.form.remark || this.form.description || '', permissions };
        try {
          const url = this.editingId ? `/api/admin/roles/${this.editingId}` : '/api/admin/roles';
          const method = this.editingId ? 'PUT' : 'POST';
          await apiJson(url, { method, body: JSON.stringify(body) });
          toast(this.editingId ? '角色已更新' : '角色已创建');
          this.showRole = false;
          this.showList = false;
          await this.refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      async removeRole(role) {
        if (role.builtin) return toast('内置角色不可删除', 'error');
        if (!confirm(`确定删除角色 "${role.label || role.id}"？`)) return;
        try {
          await apiJson(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
          toast('角色已删除');
          await this.refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      roleTypeName,
      dateText
    },
    mounted() { this.refresh(); },
    template: `
      <section class="vue-admin-page">
        <div class="vue-access-card">
          <div class="vue-role-filters">
            <label><span>角色名称</span><input v-model="query" placeholder="请输入角色名称" /></label>
            <label><span>状态</span><select v-model="status"><option value="">角色状态</option><option value="active">正常</option><option value="disabled">停用</option></select></label>
            <button class="vue-btn primary" @click="refresh">搜索</button>
            <button class="vue-btn" @click="resetFilters">重置</button>
          </div>
          <div class="vue-toolbar">
            <div class="vue-tabs inline">
              <button :class="{active:tab==='platform'}" @click="switchTab('platform')">后台角色</button>
              <button :class="{active:tab==='enterprise'}" @click="switchTab('enterprise')">前台角色</button>
            </div>
            <span class="vue-spacer"></span>
            <button class="vue-btn primary" @click="openRole(null)">添加</button>
            <button class="vue-btn danger">删除</button>
            <button class="vue-btn warn">导出</button>
          </div>
          <table class="vue-table">
            <thead>
              <tr>
                <th><input type="checkbox" disabled /></th>
                <th>角色编号</th>
                <th>角色名称</th>
                <th>显示顺序</th>
                <th>备注</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="role in filteredRoles" :key="role.id">
                <td><input type="checkbox" /></td>
                <td>{{ role.id }}</td>
                <td>{{ role.label || role.id }}</td>
                <td>{{ role.display_order || 0 }}</td>
                <td>{{ role.remark || role.description || '-' }}</td>
                <td><button class="vue-switch" :class="{on:(role.status || 'active')==='active'}" @click="toggleRoleStatus(role)"><i></i></button></td>
                <td>{{ dateText(role.created_at) }}</td>
                <td class="vue-actions">
                  <button @click="openRole(role)">修改</button>
                  <button @click="openList(role)">列表授权</button>
                  <button v-if="!role.builtin" @click="removeRole(role)">删除</button>
                </td>
              </tr>
              <tr v-if="!filteredRoles.length"><td colspan="8" class="vue-empty">暂无角色</td></tr>
            </tbody>
          </table>
        </div>
        <div class="vue-modal-mask" v-if="showRole" @click.self="showRole=false">
          <div class="vue-modal role-tree-modal">
            <div class="vue-modal-head"><b>{{ editingId ? '修改角色' : '新增角色' }}</b><button @click="showRole=false">×</button></div>
            <div class="role-edit-form">
              <label class="role-edit-row required"><span>角色名称</span><input v-model.trim="form.label" placeholder="请输入角色名称" /></label>
              <label class="role-edit-row required"><span>角色顺序</span><input type="number" v-model.number="form.display_order" /></label>
              <div class="role-edit-row"><span>状态</span><div class="inline-options"><label><input type="radio" value="active" v-model="form.status" />正常</label><label><input type="radio" value="disabled" v-model="form.status" />停用</label></div></div>
              <div class="role-edit-row"><span>菜单权限</span><div class="inline-options"><button class="mini-btn" @click="toggleAllExpanded">{{ allMenuExpanded ? '折叠全部' : '展开全部' }}</button><button class="mini-btn" @click="toggleAllMenuSelected">{{ allMenuSelected ? '清空权限' : '全选权限' }}</button></div></div>
              <div class="role-edit-row"><span></span><label class="single-check"><input type="checkbox" checked disabled />父子联动</label></div>
              <div class="role-edit-row tree-row-wrap"><span></span><div class="perm-tree">
                <div v-for="group in menuTree" :key="group.id" class="tree-block">
                  <div class="tree-line group">
                    <button @click.prevent="toggleExpand(group.id)">{{ expanded.has(group.id) ? '▾' : '▸' }}</button>
                    <input type="checkbox" :checked="isNodeChecked(group)" @change="toggleNode(group,$event.target.checked)" />
                    <b>{{ group.label }}</b>
                  </div>
                  <div v-show="expanded.has(group.id)" class="tree-children">
                    <div v-for="module in group.children" :key="module.id" class="tree-module">
                      <div class="tree-line module">
                        <button @click.prevent="toggleExpand(module.id)">{{ expanded.has(module.id) ? '▾' : '▸' }}</button>
                        <input type="checkbox" :checked="isNodeChecked(module)" @change="toggleNode(module,$event.target.checked)" />
                        <span>{{ module.label }}</span>
                      </div>
                      <div v-show="expanded.has(module.id)" class="tree-actions">
                        <label v-for="action in module.children" :key="action.id"><input type="checkbox" :checked="selected.has(action.key)" @change="toggleNode(action,$event.target.checked)" />{{ action.label }}</label>
                      </div>
                    </div>
                  </div>
                </div>
              </div></div>
              <label class="role-edit-row"><span>备注</span><textarea v-model.trim="form.remark" placeholder="请输入内容"></textarea></label>
            </div>
            <div class="vue-modal-foot"><button class="vue-btn" @click="showRole=false">取消</button><button class="vue-btn primary" @click="saveRole">确定</button></div>
          </div>
        </div>
        <div class="vue-modal-mask" v-if="showList" @click.self="showList=false">
          <div class="vue-modal list-auth-modal">
            <div class="vue-modal-head"><b>列表授权</b><button @click="showList=false">×</button></div>
            <div class="list-auth-line"><span>角色名称</span><b>{{ form.label }}</b></div>
            <div class="list-auth-line"><span>列表授权</span><button class="vue-link" @click="setAllList(true)">全选</button><button class="vue-link" @click="setAllList(false)">清空</button></div>
            <div class="list-auth-sections">
              <section v-for="section in listAuthSections" :key="section.title">
                <h4><input type="checkbox" :checked="section.columns.every(column=>listSelected.has(column.id))" @change="section.columns.forEach(column=>toggleList(column.id,$event.target.checked))" />{{ section.title }}</h4>
                <label v-for="column in section.columns" :key="column.id"><input type="checkbox" :checked="listSelected.has(column.id)" @change="toggleList(column.id,$event.target.checked)" />{{ column.label }}</label>
              </section>
            </div>
            <div class="vue-modal-foot"><button class="vue-btn" @click="showList=false">取消</button><button class="vue-btn primary" @click="saveRole">确定</button></div>
          </div>
        </div>
      </section>`
  }).mount('#admin-roles-vue');
})();
