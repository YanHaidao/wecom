# OpenClaw 企业微信文档能力技能清单

> 本清单列出所有企业微信文档相关的 MCP Tools，按功能模块分类，方便 OpenClaw 直接调用。

## 一、文档基础操作 (Doc Basic Operations)

### 1.1 创建文档
```json
{
  "name": "wecom_doc",
  "action": "create",
  "description": "创建文档/表格/智能表格",
  "parameters": {
    "docName": "文档名称",
    "docType": "doc|spreadsheet|smart_table|3|4|10",
    "spaceId": "可选：空间 ID",
    "fatherId": "可选：父目录 fileid",
    "adminUsers": "可选但推荐：文档管理员 userid 列表，创建智能表格时建议填写",
    "viewers": "可选：查看成员列表",
    "collaborators": "可选：协作者列表",
    "init_content": "可选：初始内容数组"
  },
  "returns": {
    "docId": "文档 ID",
    "url": "文档链接",
    "title": "文档标题",
    "resourceType": "资源类型"
  }
}
```

**⚠️ 智能表格创建注意事项**:
1. **adminUsers 参数** - 创建智能表格时强烈建议传入 `adminUsers: ["userid1", "userid2"]`，确保有管理员权限
2. **自动初始化** - 创建智能表格后会自动清理默认字段（5 个保留 1 个）和默认空白记录（5 条）
3. **默认字段类型** - 文本、数字、日期、单选、人员，其中文本/数字/日期等可作为主键

### 1.2 重命名文档
```json
{
  "name": "wecom_doc",
  "action": "rename",
  "description": "重命名文档",
  "parameters": {
    "docId": "文档 ID",
    "newName": "新名称"
  }
}
```

### 1.3 复制文档
```json
{
  "name": "wecom_doc",
  "action": "copy",
  "description": "复制文档",
  "parameters": {
    "docId": "文档 ID",
    "newName": "新文档名称",
    "spaceId": "可选：目标空间 ID",
    "fatherId": "可选：目标父目录"
  }
}
```

### 1.4 获取文档信息
```json
{
  "name": "wecom_doc",
  "action": "get_info",
  "description": "获取文档基本信息",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "doc_name": "文档名称",
    "doc_type": "文档类型"
  }
}
```

### 1.5 获取分享链接
```json
{
  "name": "wecom_doc",
  "action": "share",
  "description": "获取文档分享链接",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "shareUrl": "分享链接"
  }
}
```

### 1.6 删除文档
```json
{
  "name": "wecom_doc",
  "action": "delete",
  "description": "删除文档或收集表",
  "parameters": {
    "docId": "可选：文档 ID",
    "formId": "可选：收集表 ID"
  }
}
```

---

## 二、文档权限管理 (Doc Permission Management)

### 2.1 获取文档权限
```json
{
  "name": "wecom_doc",
  "action": "get_auth",
  "description": "获取文档权限信息",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "docMembers": "查看成员列表",
    "coAuthList": "协作者列表",
    "accessRule": "访问规则"
  }
}
```

### 2.2 诊断文档权限
```json
{
  "name": "wecom_doc",
  "action": "diagnose_auth",
  "description": "诊断文档访问权限问题",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "internalAccessEnabled": "企业内访问是否开启",
    "externalAccessEnabled": "企业外访问是否开启",
    "requesterRole": "请求人角色",
    "findings": "诊断发现",
    "recommendations": "建议"
  }
}
```

### 2.3 校验分享链接
```json
{
  "name": "wecom_doc",
  "action": "validate_share_link",
  "description": "校验分享链接可用性",
  "parameters": {
    "shareUrl": "分享链接"
  },
  "returns": {
    "httpStatus": "HTTP 状态码",
    "userType": "访问身份",
    "padType": "页面类型",
    "findings": "诊断发现"
  }
}
```

### 2.4 设置加入规则
```json
{
  "name": "wecom_doc",
  "action": "set_join_rule",
  "description": "设置文档加入规则",
  "parameters": {
    "docId": "文档 ID",
    "request": {
      "enable_corp_internal": "是否开启企业内访问",
      "corp_internal_auth": "企业内权限：1 只读 2 编辑",
      "enable_corp_external": "是否开启企业外访问",
      "ban_share_external": "是否禁止外部分享"
    }
  }
}
```

### 2.5 设置成员权限
```json
{
  "name": "wecom_doc",
  "action": "set_member_auth",
  "description": "设置文档通知范围及成员权限",
  "parameters": {
    "docId": "文档 ID",
    "request": {
      "notified_scope_type": "通知范围类型",
      "notified_member_list": "通知成员列表"
    }
  }
}
```

### 2.6 授予/撤销访问权限
```json
{
  "name": "wecom_doc",
  "action": "grant_access",
  "description": "批量授予或撤销文档访问权限",
  "parameters": {
    "docId": "文档 ID",
    "viewers": "可选：查看成员列表",
    "collaborators": "可选：协作者列表",
    "removeViewers": "可选：移除查看成员",
    "removeCollaborators": "可选：移除协作者",
    "auth": "可选：权限级别"
  }
}
```

### 2.7 添加协作者
```json
{
  "name": "wecom_doc",
  "action": "add_collaborators",
  "description": "添加文档协作者",
  "parameters": {
    "docId": "文档 ID",
    "collaborators": "协作者列表",
    "auth": "可选：权限级别"
  }
}
```

### 2.8 设置安全设置
```json
{
  "name": "wecom_doc",
  "action": "set_safety_setting",
  "description": "设置文档安全设置（水印、复制等）",
  "parameters": {
    "docId": "文档 ID",
    "request": {
      "watermark": "水印设置",
      "disable_copy": "禁止复制",
      "disable_print": "禁止打印"
    }
  }
}
```

### 2.9 获取安全设置
```json
{
  "name": "wecom_doc",
  "action": "get_doc_security_setting",
  "description": "获取文档安全设置",
  "parameters": {
    "docId": "文档 ID"
  }
}
```

---

## 三、文档内容操作 (Doc Content Operations)

### 3.1 获取文档内容
```json
{
  "name": "wecom_doc",
  "action": "get_content",
  "description": "获取文档完整内容（包含版本号和文档树）",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "version": "文档版本号",
    "document": "文档内容树（Node 结构）"
  }
}
```

### 3.2 更新文档内容
```json
{
  "name": "wecom_doc",
  "action": "update_content",
  "description": "批量更新文档内容（最多 30 个操作）",
  "parameters": {
    "docId": "文档 ID",
    "requests": [
      {
        "replace_text": { "text": "替换文本", "ranges": [{"start_index": 0, "length": 5}] }
      },
      {
        "insert_text": { "text": "插入文本", "location": { "index": 10 } }
      },
      {
        "insert_image": { "image_id": "图片 URL", "location": { "index": 20 } }
      },
      {
        "insert_table": { "rows": 3, "cols": 3, "location": { "index": 30 } }
      },
      {
        "insert_paragraph": { "location": { "index": 40 } }
      },
      {
        "update_text_property": { "text_property": { "bold": true }, "ranges": [...] }
      }
    ],
    "version": "可选：文档版本号"
  },
  "returns": {
    "batches": "分批数量（超过 30 个操作时自动分批）"
  }
}
```

### 3.3 上传图片到文档
```json
{
  "name": "wecom_doc",
  "action": "upload_doc_image",
  "description": "上传图片到文档（获取 image_id）",
  "parameters": {
    "docId": "文档 ID",
    "file_path": "本地图片路径"
  },
  "returns": {
    "url": "图片 URL",
    "width": "图片宽度",
    "height": "图片高度",
    "size": "文件大小"
  }
}
```

---

## 四、在线表格操作 (Spreadsheet Operations)

### 4.1 获取表格属性
```json
{
  "name": "wecom_doc",
  "action": "get_sheet_properties",
  "description": "获取在线表格所有工作表属性",
  "parameters": {
    "docId": "文档 ID"
  },
  "returns": {
    "properties": [
      {
        "sheet_id": "工作表 ID",
        "title": "工作表标题",
        "row_count": "行数",
        "column_count": "列数"
      }
    ]
  }
}
```

### 4.2 获取表格数据
```json
{
  "name": "wecom_doc",
  "action": "get_sheet_data",
  "description": "获取指定范围内的单元格数据",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "工作表 ID",
    "range": "A1 表示法范围，如 A1:B5"
  },
  "returns": {
    "data": {
      "start_row": "起始行",
      "start_column": "起始列",
      "rows": [{ "values": [{ "cell_value": {...}, "cell_format": {...} }] }]"
    }
  }
}
```

### 4.3 编辑表格数据
```json
{
  "name": "wecom_doc",
  "action": "edit_sheet_data",
  "description": "编辑表格单元格数据（最多 5 个操作）",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "工作表 ID",
    "startRow": "可选：起始行（从 0 开始）",
    "startColumn": "可选：起始列（从 0 开始）",
    "gridData": {
      "rows": [
        { "values": [{ "cell_value": { "text": "内容" } }] }
      ]
    }
  }
}
```

### 4.4 修改表格属性
```json
{
  "name": "wecom_doc",
  "action": "modify_sheet_properties",
  "description": "修改工作表属性（添加/删除/重命名）",
  "parameters": {
    "docId": "文档 ID",
    "requests": [
      {
        "add_sheet_request": { "title": "新工作表", "row_count": 10, "column_count": 10 }
      },
      {
        "delete_sheet_request": { "sheet_id": "要删除的工作表 ID" }
      },
      {
        "update_range_request": { "sheet_id": "...", "grid_data": {...} }
      },
      {
        "delete_dimension_request": { "sheet_id": "...", "dimension": "ROW|COLUMN", "start_index": 1, "end_index": 5 }
      }
    ]
  }
}
```

---

## 五、智能表格操作 (Smart Table Operations)

### 5.1 查询子表
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_sheets",
  "description": "查询智能表格所有子表信息",
  "parameters": {
    "docId": "文档 ID",
    "sheet_id": "可选：指定子表 ID 查询",
    "need_all_type_sheet": "可选：获取所有类型子表（包含仪表盘和说明页）"
  },
  "returns": {
    "sheet_list": [
      {
        "sheet_id": "子表 ID",
        "title": "子表名称",
        "is_visible": "是否可见",
        "type": "smartsheet|dashboard|external"
      }
    ]
  }
}
```

**⚠️ 智能表格自动初始化**:
创建智能表格 (`docType=10` 或 `smart_table`) 时，系统会自动执行以下初始化操作：
1. 获取默认子表（类型为 `smartsheet` 的第一个子表）
2. 获取默认字段（通常有 5 个：文本、数字、日期、单选、人员）
3. 删除 4 个默认字段，保留 1 个可作为主键的字段
4. 获取默认记录（通常有 5 条空白记录）
5. 删除所有默认空白记录

这样可以确保新创建的智能表格是干净的，用户可以根据需求添加自定义字段和记录。

### 5.2 添加子表
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_sheet",
  "description": "添加智能表格子表",
  "parameters": {
    "docId": "文档 ID",
    "title": "子表标题",
    "index": "可选：子表下标"
  },
  "returns": {
    "properties": {
      "sheet_id": "生成的子表 ID",
      "title": "子表标题",
      "index": "子表下标"
    }
  }
}
```

### 5.3 删除子表
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_sheet",
  "description": "删除智能表格子表",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID"
  }
}
```

### 5.4 更新子表
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_sheet",
  "description": "修改子表标题",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "title": "新标题"
  }
}
```

### 5.5 添加视图
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_view",
  "description": "在子表中添加新视图",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "view_title": "视图标题",
    "view_type": "VIEW_TYPE_GRID|VIEW_TYPE_KANBAN|VIEW_TYPE_GALLERY|VIEW_TYPE_GANTT|VIEW_TYPE_CALENDAR",
    "property": "可选：视图属性（sort_spec, filter_spec, group_spec 等）"
  },
  "returns": {
    "view": {
      "view_id": "视图 ID",
      "view_title": "视图标题",
      "view_type": "视图类型"
    }
  }
}
```

### 5.6 更新视图
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_view",
  "description": "更新视图属性",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "view_id": "视图 ID",
    "view_title": "可选：新视图标题",
    "property": "可选：视图属性（sort_spec, filter_spec, group_spec, color_config 等）"
  }
}
```

### 5.7 删除视图
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_view",
  "description": "删除一个或多个视图",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "view_ids": ["视图 ID 列表"]
  }
}
```

### 5.8 查询视图
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_views",
  "description": "获取子表下所有视图信息",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "view_ids": "可选：指定视图 ID 列表",
    "offset": "可选：偏移量",
    "limit": "可选：分页大小（最大 1000）"
  },
  "returns": {
    "views": [...],
    "total": "视图总数",
    "has_more": "是否还有更多",
    "next": "下次查询的偏移量"
  }
}
```

### 5.9 添加字段
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_fields",
  "description": "在子表中添加一个或多个字段（单表最多 150 个字段）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，表格 ID",
    "fields": "必填：object[]，字段详情数组",
    "fields[].field_title": "必填：string，字段标题",
    "fields[].field_type": "必填：string，字段类型，见下方字段类型对照表",
    "fields[].property_number": "可选：object，数字类型的字段属性，{decimal_places: 2, use_separate: true}",
    "fields[].property_checkbox": "可选：object，复选框类型的字段属性，{checked: true}",
    "fields[].property_date_time": "可选：object，日期类型的字段属性，{format: \"yyyy-mm-dd\", auto_fill: false}",
    "fields[].property_attachment": "可选：object，文件类型的字段属性，{display_mode: \"DISPLAY_MODE_LIST\"}",
    "fields[].property_user": "可选：object，人员类型的字段属性，{is_multiple: true, is_notified: true}",
    "fields[].property_url": "可选：object，超链接类型的字段属性，{type: \"LINK_TYPE_PURE_TEXT\"}",
    "fields[].property_select": "可选：object，多选类型的字段属性，{is_quick_add: true, options: [{id: \"1\", text: \"选项 1\", style: 1}]}",
    "fields[].property_created_time": "可选：object，创建时间类型的字段属性，{format: \"yyyy-mm-dd\"}",
    "fields[].property_modified_time": "可选：object，最后编辑时间类型的字段属性，{format: \"yyyy-mm-dd\"}",
    "fields[].property_progress": "可选：object，进度类型的字段属性，{decimal_places: 2}",
    "fields[].property_single_select": "可选：object，单选类型的字段属性，{is_quick_add: true, options: [...]}",
    "fields[].property_reference": "可选：object，关联类型的字段属性，{sub_id: \"\", field_id: \"\", is_multiple: false, view_id: \"\"}",
    "fields[].property_location": "可选：object，地理位置类型的字段属性，{input_type: \"LOCATION_INPUT_TYPE_MANUAL\"}",
    "fields[].property_auto_number": "可选：object，自动编号类型的字段属性，{type: \"NUMBER_TYPE_INCR\", rules: [...], reformat_existing_record: false}",
    "fields[].property_currency": "可选：object，货币类型的字段属性，{currency_type: \"CURRENCY_TYPE_CNY\", decimal_places: 2, use_separate: true}",
    "fields[].property_ww_group": "可选：object，群类型的字段属性，{allow_multiple: true}",
    "fields[].property_percentage": "可选：object，百分数类型的字段属性，{decimal_places: 2, use_separate: true}",
    "fields[].property_barcode": "可选：object，条码类型的字段属性，{mobile_scan_only: false}",
    "autoCleanupDefaultField": "可选：boolean，是否自动删除遗留的默认字段（默认 true）"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "fields": "object[]，字段详情数组",
    "fields[].field_id": "string，生成的字段 ID",
    "fields[].field_title": "string，字段标题",
    "fields[].field_type": "string，字段类型"
  }
}
```

**使用示例** - 添加文本字段:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_title": "姓名",
        "field_type": "FIELD_TYPE_TEXT"
      },
      {
        "field_title": "备注",
        "field_type": "FIELD_TYPE_TEXT"
      }
    ]
  }
}
```

**使用示例** - 添加数字和日期字段:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_title": "年龄",
        "field_type": "FIELD_TYPE_NUMBER",
        "property_number": {
          "decimal_places": 0,
          "use_separate": false
        }
      },
      {
        "field_title": "入职日期",
        "field_type": "FIELD_TYPE_DATE_TIME",
        "property_date_time": {
          "format": "yyyy-mm-dd",
          "auto_fill": false
        }
      }
    ]
  }
}
```

**使用示例** - 添加多选字段:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_title": "技能",
        "field_type": "FIELD_TYPE_SELECT",
        "property_select": {
          "is_quick_add": true,
          "options": [
            {"text": "Java", "style": 1},
            {"text": "Python", "style": 2},
            {"text": "JavaScript", "style": 3}
          ]
        }
      }
    ]
  }
}
```

**⚠️ 重要注意事项**:
1. **字段属性必须与字段类型匹配** - 一种字段类型对应一种字段属性
2. **新增选项时不需要 id** - 只需填写 `text` 和 `style`，系统会自动生成 id
3. **field_type 必须使用官方常量** - 如 `FIELD_TYPE_TEXT`、`FIELD_TYPE_NUMBER` 等
4. **单表最多 150 个字段** - 超过限制会失败
5. **默认字段清理** - 创建智能表格时会自动清理默认字段（保留 1 个）
6. **自动删除遗留字段** - 第一次调用 `smartsheet_add_fields` 添加新字段后，会自动删除遗留的默认字段（可通过 `autoCleanupDefaultField: false` 禁用）

**字段类型与属性对照表**:

| 字段类型 | 字段属性 | 说明 |
|----------|----------|------|
| FIELD_TYPE_TEXT | 无 | 文本类型不需要属性 |
| FIELD_TYPE_NUMBER | property_number | 数字类型，可设置小数位数和千位符 |
| FIELD_TYPE_CHECKBOX | property_checkbox | 复选框类型，可设置默认是否勾选 |
| FIELD_TYPE_DATE_TIME | property_date_time | 日期类型，可设置日期格式和自动填充 |
| FIELD_TYPE_IMAGE | 无 | 图片类型不需要属性 |
| FIELD_TYPE_ATTACHMENT | property_attachment | 文件类型，可设置展示样式（列表/宫格） |
| FIELD_TYPE_USER | property_user | 人员类型，可设置是否多选和是否通知 |
| FIELD_TYPE_URL | property_url | 超链接类型，可设置展示样式（文字/图标文字） |
| FIELD_TYPE_SELECT | property_select | 多选类型，可设置选项和是否允许新增 |
| FIELD_TYPE_SINGLE_SELECT | property_single_select | 单选类型，可设置选项和是否允许新增 |
| FIELD_TYPE_CREATED_TIME | property_created_time | 创建时间类型，可设置日期格式 |
| FIELD_TYPE_MODIFIED_TIME | property_modified_time | 最后编辑时间类型，可设置日期格式 |
| FIELD_TYPE_PROGRESS | property_progress | 进度类型，可设置小数位数 |
| FIELD_TYPE_PHONE_NUMBER | 无 | 电话类型不需要属性 |
| FIELD_TYPE_EMAIL | 无 | 邮箱类型不需要属性 |
| FIELD_TYPE_REFERENCE | property_reference | 关联类型，可设置关联子表和字段 |
| FIELD_TYPE_LOCATION | property_location | 地理位置类型，可设置输入类型（手动/自动） |
| FIELD_TYPE_CURRENCY | property_currency | 货币类型，可设置货币类型和小数位数 |
| FIELD_TYPE_WWGROUP | property_ww_group | 群类型，可设置是否多选 |
| FIELD_TYPE_AUTONUMBER | property_auto_number | 自动编号类型，可设置编号规则 |
| FIELD_TYPE_PERCENTAGE | property_percentage | 百分数类型，可设置小数位数 |
| FIELD_TYPE_BARCODE | property_barcode | 条码类型，可设置是否仅限手机扫描 |

### 5.10 删除字段
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_fields",
  "description": "删除一个或多个字段",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，表格 ID",
    "field_ids": "必填：string[]，需要删除的字段 id 列表"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "field_ids": ["f1gHSR", "fabcde"]
  }
}
```

---

### 5.11 更新字段
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_fields",
  "description": "更新字段的标题和字段属性（不能更新字段类型）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，表格 ID",
    "fields": "必填：object[]，字段详情数组",
    "fields[].field_id": "必填：string，字段 ID（不能更新）",
    "fields[].field_title": "可选：string，新字段标题（不能更新为原值）",
    "fields[].field_type": "必填：string，字段类型（必须为原类型）",
    "fields[].property_number": "可选：object，数字类型的字段属性",
    "fields[].property_checkbox": "可选：object，复选框类型的字段属性",
    "fields[].property_date_time": "可选：object，日期类型的字段属性",
    "fields[].property_attachment": "可选：object，文件类型的字段属性",
    "fields[].property_user": "可选：object，人员类型的字段属性",
    "fields[].property_url": "可选：object，超链接类型的字段属性",
    "fields[].property_select": "可选：object，多选类型的字段属性",
    "fields[].property_created_time": "可选：object，创建时间类型的字段属性",
    "fields[].property_modified_time": "可选：object，最后编辑时间类型的字段属性",
    "fields[].property_progress": "可选：object，进度类型的字段属性",
    "fields[].property_single_select": "可选：object，单选类型的字段属性",
    "fields[].property_reference": "可选：object，关联类型的字段属性",
    "fields[].property_location": "可选：object，地理位置类型的字段属性",
    "fields[].property_auto_number": "可选：object，自动编号类型的字段属性",
    "fields[].property_currency": "可选：object，货币类型的字段属性",
    "fields[].property_ww_group": "可选：object，群类型的字段属性",
    "fields[].property_percentage": "可选：object，百分数类型的字段属性",
    "fields[].property_barcode": "可选：object，条码类型的字段属性"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "fields": "object[]，字段详情数组"
  }
}
```

**使用示例** - 更新字段标题:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_id": "f1gHSR",
        "field_title": "员工姓名",
        "field_type": "FIELD_TYPE_TEXT"
      }
    ]
  }
}
```

**使用示例** - 更新字段属性:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_id": "fabcde",
        "field_type": "FIELD_TYPE_NUMBER",
        "property_number": {
          "decimal_places": 2,
          "use_separate": true
        }
      }
    ]
  }
}
```

**⚠️ 重要注意事项**:
1. **不能更新字段类型** - 只能更新字段标题和字段属性
2. **field_title 和 property 至少传一个** - 且 field_title 不能被更新为原值
3. **field_id 不能更新** - 仅用于标识要更新的字段
4. **字段属性必须与字段类型匹配** - 与添加字段时相同

---

### 5.12 查询字段
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_fields",
  "description": "获取子表下字段信息（支持分页、按字段 ID 或字段标题筛选）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，表格 ID",
    "view_id": "可选：string，视图 ID",
    "field_ids": "可选：string[]，由字段 ID 组成的 JSON 数组",
    "field_titles": "可选：string[]，由字段标题组成的 JSON 数组",
    "offset": "可选：integer，偏移量，初始值为 0",
    "limit": "可选：integer，分页大小，每页返回多少条数据；当不填写该参数或将该参数设置为 0 时，如果总数大于 1000，一次性返回 1000 个字段，当总数小于 1000 时，返回全部字段；limit 最大值为 1000"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "total": "integer，字段总数",
    "fields": "object[]，字段详情数组",
    "fields[].field_id": "string，字段 ID",
    "fields[].field_title": "string，字段标题",
    "fields[].field_type": "string，字段类型",
    "fields[].property_*": "可选：object，对应字段类型的属性"
  }
}
```

**使用示例** - 获取全部字段:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "offset": 0,
    "limit": 100
  }
}
```

**使用示例** - 按字段 ID 查询:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "field_ids": ["f1gHSR", "fabcde"]
  }
}
```

**使用示例** - 按字段标题查询:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "field_titles": ["姓名", "年龄"]
  }
}
```

### 5.13 添加编组
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_group",
  "description": "添加字段编组",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "name": "编组名称",
    "children": ["可选：字段 ID 列表"]
  }
}
```

### 5.14 删除编组
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_group",
  "description": "删除编组",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "field_group_id": "编组 ID"
  }
}
```

### 5.15 更新编组
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_group",
  "description": "更新编组",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID",
    "field_group_id": "编组 ID",
    "name": "可选：新编组名称",
    "children": ["可选：字段 ID 列表"]
  }
}
```

### 5.16 获取编组
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_groups",
  "description": "获取编组列表",
  "parameters": {
    "docId": "文档 ID",
    "sheetId": "子表 ID"
  }
}
```

### 5.17 添加记录
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_records",
  "description": "添加一行或多行记录（单表最多 100000 行记录，1500000 个单元格，单次建议 500 行内）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，Smartsheet 子表 ID",
    "key_type": "可选：string，values 的 key 类型，CELL_VALUE_KEY_TYPE_FIELD_TITLE(默认，用字段标题)|CELL_VALUE_KEY_TYPE_FIELD_ID(用字段 ID)",
    "records": "必填：object[]，需要添加的记录数组",
    "records[].values": "必填：object，记录的具体内容，key 为字段标题或字段 ID",
    "records[].values.文本字段 (FIELD_TYPE_TEXT)": "可选：object[]，[{\"type\": \"text\", \"text\": \"内容\"}] 或 [{\"type\": \"url\", \"text\": \"文本\", \"link\": \"URL\"}]",
    "records[].values.数字字段 (FIELD_TYPE_NUMBER)": "可选：number，直接写数字如 25 或 15000.50（不需要数组）",
    "records[].values.日期字段 (FIELD_TYPE_DATE_TIME)": "可选：string，毫秒时间戳字符串如 \"1704067200000\"（不需要数组）",
    "records[].values.多选字段 (FIELD_TYPE_SELECT)": "可选：object[]，[{\"text\": \"选项文本\", \"style\": 1}] 新增选项，或 [{\"id\": \"已有选项 ID\"}] 使用已有选项",
    "records[].values.单选字段 (FIELD_TYPE_SINGLE_SELECT)": "可选：object[]，[{\"text\": \"选项文本\", \"style\": 1}] 新增选项，或 [{\"id\": \"已有选项 ID\"}] 使用已有选项",
    "records[].values.成员字段 (FIELD_TYPE_USER)": "可选：object[]，[{\"user_id\": \"成员 userid\"}]",
    "records[].values.复选框字段 (FIELD_TYPE_CHECKBOX)": "可选：boolean[]，[true] 或 [false]",
    "records[].values.进度字段 (FIELD_TYPE_PROGRESS)": "可选：number，直接写数字如 0.5 表示 50%（不需要数组）",
    "records[].values.电话字段 (FIELD_TYPE_PHONE_NUMBER)": "可选：string[]，[\"13800138000\"]",
    "records[].values.邮箱字段 (FIELD_TYPE_EMAIL)": "可选：string[] 或 object[]，[\"test@example.com\"] 或 [{\"type\": \"url\", \"text\": \"test@example.com\", \"link\": \"mailto:test@example.com\"}]",
    "records[].values.链接字段 (FIELD_TYPE_URL)": "可选：object[]，[{\"type\": \"url\", \"text\": \"显示文本\", \"link\": \"跳转 URL\"}]",
    "records[].values.地理位置字段 (FIELD_TYPE_LOCATION)": "可选：object[]，[{\"id\": \"地点 ID\", \"latitude\": \"纬度\", \"longitude\": \"经度\", \"title\": \"地点名称\", \"source_type\": 1}]",
    "records[].values.货币字段 (FIELD_TYPE_CURRENCY)": "可选：number，直接写数字如 100.50（不需要数组）",
    "records[].values.百分数字段 (FIELD_TYPE_PERCENTAGE)": "可选：number，直接写数字如 0.75 表示 75%（不需要数组）",
    "records[].values.条码字段 (FIELD_TYPE_BARCODE)": "可选：string[]，[\"6901234567890\"]"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "records": "object[]，添加成功的记录数组"
  }
}
```

**使用示例** - 添加文本和数字记录:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "key_type": "CELL_VALUE_KEY_TYPE_FIELD_TITLE",
    "records": [
      {
        "values": {
          "姓名": [{"type": "text", "text": "张三"}],
          "年龄": 25,
          "部门": [{"type": "text", "text": "技术部"}],
          "入职日期": "1704067200000",
          "是否全职": [true],
          "工资": 15000.50
        }
      }
    ]
  }
}
```

**⚠️ 关键格式说明（根据实际 API 测试）**:

1. **字段值格式因类型而异**:
   - ✅ 数字类型 (NUMBER, PROGRESS, CURRENCY, PERCENTAGE): 直接写数字 `25`、`0.75`、`100.50`
   - ✅ 日期类型 (DATE_TIME): 直接写毫秒时间戳字符串 `"1704067200000"`
   - ✅ 文本类型 (TEXT, URL): 数组格式 `[{"type": "text", "text": "内容"}]`
   - ✅ 成员类型 (USER): 数组格式 `[{"user_id": "zhangsan"}]`
   - ✅ 选项类型 (SELECT, SINGLE_SELECT): 数组格式 `[{"text": "选项", "style": 1}]` 或 `[{"id": "opt1"}]`
   - ✅ 复选框 (CHECKBOX): 数组格式 `[true]` 或 `[false]`
   - ✅ 电话/邮箱/条码：数组格式 `["13800138000"]`

2. **文本类型必须带 type 字段**
   - 普通文本：`[{"type": "text", "text": "内容"}]`
   - 链接文本：`[{"type": "url", "text": "显示文本", "link": "跳转 URL"}]`

3. **日期类型是毫秒时间戳字符串**
   - ✅ 正确：`"1704067200000"`
   - ❌ 错误：`1704067200000`（数字）、`"2024-01-01"`（日期字符串）

4. **单选/多选字段使用 Option 对象**
   - 新增选项：`[{"text": "选项文本", "style": 1}]`（不需要 id）
   - 使用已有选项：`[{"id": "已有选项 ID"}]`（优先匹配已有选项）

5. **values 的 key 必须与字段标题或字段 ID 完全匹配**
   - 如果 `key_type` 为 `CELL_VALUE_KEY_TYPE_FIELD_TITLE`，使用字段标题
   - 如果 `key_type` 为 `CELL_VALUE_KEY_TYPE_FIELD_ID`，使用字段 ID

6. **严格验证，不自动转换**:
   - ❌ 不会将普通字符串自动转换为 `[{"type": "text", "text": "..."}]`
   - ❌ 不会将 13 位数字字符串误判为时间戳（必须是字符串格式）
   - ✅ 数字和日期类型保持原样
   - ✅ 对象格式自动包裹为数组：`{user_id: "..."}` → `[{user_id: "..."}]`
   - ⚠️ 模糊的原始值（如普通字符串 `"张三"`）会被拒绝，必须明确使用数组格式

**使用示例** - 添加多选和成员记录:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "records": [
      {
        "values": {
          "姓名": [{"type": "text", "text": "王五"}],
          "技能": [
            {"text": "Java", "style": 1},
            {"text": "Python", "style": 2}
          ],
          "负责人": [{"user_id": "zhangsan"}],
          "进度": [0.75],
          "邮箱": [{"type": "url", "text": "wangwu@example.com", "link": "mailto:wangwu@example.com"}]
        }
      }
    ]
  }
}
```

**⚠️ 单选/多选字段格式说明**:

1. **新增选项**（选项中不存在该值）:
   ```json
   [{"text": "新选项", "style": 1}]
   ```
   - 不需要填写 `id`
   - 必须填写 `text` 和 `style`（颜色 1-27）

2. **使用已有选项**（选项中已存在）:
   ```json
   [{"id": "已有选项 ID"}]
   ```
   - 只需要填写 `id`
   - 系统会优先匹配已有选项

3. **混合使用**:
   ```json
   [
     {"id": "已有选项 ID"},
     {"text": "新选项", "style": 1}
   ]
   ```

**⚠️ 重要注意事项**:
1. **字段值格式因类型而异** - 数字/日期类型直接写值（`25`、`"1704067200000"`），文本/成员/选项类型用数组（`[{"type": "text", "text": "内容"}]`）
2. **文本类型必须带 type** - `[{"type": "text", "text": "内容"}]` 或 `[{"type": "url", "text": "文本", "link": "URL"}]`
3. **不能添加记录的字段类型** - 创建时间、最后编辑时间、创建人、最后编辑人这四种类型的字段不能通过接口添加值（系统自动填充）
4. **key_type 决定 values 的 key** - 使用字段标题或字段 ID 作为 key，默认使用字段标题
5. **单次添加建议 500 行内** - 避免超时或失败
6. **插件严格验证** - 拒绝模糊的原始值，必须使用正确的格式

**字段类型与值类型对照表**:

| 字段类型 | 值类型 | 示例值 |
|----------|--------|--------|
| 文本 (FIELD_TYPE_TEXT) | object[] | `[{"type": "text", "text": "内容"}]` |
| 数字 (FIELD_TYPE_NUMBER) | number | `25` 或 `15000.50` |
| 复选框 (FIELD_TYPE_CHECKBOX) | boolean[] | `[true]` 或 `[false]` |
| 日期 (FIELD_TYPE_DATE_TIME) | string | `"1704067200000"` (毫秒时间戳) |
| 成员 (FIELD_TYPE_USER) | object[] | `[{"user_id": "zhangsan"}]` |
| 多选 (FIELD_TYPE_SELECT) | object[] | `[{"id": "opt1", "text": "选项", "style": 1}]` |
| 单选 (FIELD_TYPE_SINGLE_SELECT) | object[] | `[{"id": "opt1", "text": "选项", "style": 1}]` |
| 进度 (FIELD_TYPE_PROGRESS) | number | `0.75` (0-1 之间) |
| 电话 (FIELD_TYPE_PHONE_NUMBER) | string[] | `["13800138000"]` |
| 邮箱 (FIELD_TYPE_EMAIL) | string[] 或 object[] | `["test@example.com"]` 或 `[{"type": "url", "text": "test@example.com", "link": "mailto:test@example.com"}]` |
| 链接 (FIELD_TYPE_URL) | object[] | `[{"type": "url", "text": "显示文本", "link": "https://..."}]` |
| 货币 (FIELD_TYPE_CURRENCY) | number | `100.50` |
| 百分数 (FIELD_TYPE_PERCENTAGE) | number | `0.75` (表示 75%) |
| 条码 (FIELD_TYPE_BARCODE) | string[] | `["6901234567890"]` |
| 地理位置 (FIELD_TYPE_LOCATION) | object[] | `[{"id": "地点 ID", "latitude": "23.10647", "longitude": "113.32446", "title": "广州塔", "source_type": 1}]` |

### 5.18 更新记录
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_records",
  "description": "更新一行或多行记录（不能更新创建时间、最后编辑时间、创建人、最后编辑人字段）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，Smartsheet 子表 ID",
    "key_type": "可选：string，请求中 values 的 key 类型，使用字段标题（默认）或字段 ID",
    "records": "必填：object[]，需要更新的记录数组",
    "records[].record_id": "必填：string，记录 ID",
    "records[].values": "必填：object，记录的具体内容，格式与添加记录相同",
    "记录格式参考添加记录": "数字/日期类型直接写值，文本/成员/选项类型用数组"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "records": "object[]，更新成功的记录数组"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "records": [
      {
        "record_id": "re9IqD",
        "values": {
          "姓名": [{"type": "text", "text": "张三丰"}],
          "年龄": 26,
          "部门": [{"type": "text", "text": "技术部"}],
          "工资": 16000.00,
          "是否全职": [true]
        }
      },
      {
        "record_id": "rpS0P9",
        "values": {
          "姓名": [{"type": "text", "text": "李四光"}],
          "年龄": 29,
          "部门": [{"type": "text", "text": "产品部"}],
          "工资": 19000.00
        }
      }
    ]
  }
}
```

**⚠️ 重要注意事项**:
1. **必须指定 record_id** - 用于标识要更新的记录
2. **字段值格式与添加记录相同** - 数字/日期类型直接写值，文本/成员/选项类型用数组
3. **不能更新的字段类型** - 创建时间、最后编辑时间、创建人、最后编辑人（系统自动更新）
4. **只更新指定的字段** - 未指定的字段保持不变
5. **文本类型必须带 type** - `[{"type": "text", "text": "内容"}]`

### 5.19 删除记录
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_records",
  "description": "删除一行或多行记录（单表最多 100000 行记录，单次删除建议 500 行内）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，Smartsheet 子表 ID",
    "record_ids": "必填：string[]，要删除的记录 ID 列表"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述"
  }
}
```

**使用示例**:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "record_ids": ["re9IqD", "rpS0P9"]
  }
}
```

### 5.20 查询记录
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "description": "获取记录列表（支持筛选、排序、分页、按字段过滤）",
  "parameters": {
    "docId": "必填：string，文档的 docid",
    "sheetId": "必填：string，Smartsheet 子表 ID",
    "view_id": "可选：string，视图 ID",
    "record_ids": "可选：string[]，指定记录 ID 列表",
    "key_type": "可选：string，返回记录中单元格的 key 类型，CELL_VALUE_KEY_TYPE_FIELD_TITLE(默认)|CELL_VALUE_KEY_TYPE_FIELD_ID",
    "field_titles": "可选：string[]，返回指定列（字段标题数组）",
    "field_ids": "可选：string[]，返回指定列（字段 ID 数组）",
    "sort": "可选：object[]，排序设置，[{field_id: "字段 ID", desc: false}]",
    "offset": "可选：integer，偏移量，初始值为 0",
    "limit": "可选：integer，分页大小，最大 1000",
    "ver": "可选：integer，版本号",
    "filter_spec": "可选：object，过滤设置，{conjunction: "CONJUNCTION_AND", conditions: [...]}"
  },
  "returns": {
    "errcode": "integer，错误码",
    "errmsg": "string，错误码描述",
    "records": "object[]，记录数组",
    "records[].record_id": "string，记录 ID",
    "records[].values": "object，记录的具体内容，key 为字段标题或字段 ID，value 为数组（根据字段类型不同而不同）",
    "total": "integer，记录总数",
    "has_more": "boolean，是否还有更多",
    "next": "integer，下次查询的偏移量",
    "ver": "integer，版本号"
  }
}
```

**使用示例** - 查询全部记录:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "offset": 0,
    "limit": 100
  }
}
```

**使用示例** - 按字段标题返回:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "key_type": "CELL_VALUE_KEY_TYPE_FIELD_TITLE",
    "field_titles": ["姓名", "年龄", "部门"],
    "limit": 50
  }
}
```

**使用示例** - 排序查询:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "sort": [
      {"field_id": "f1gHSR", "desc": false}
    ],
    "limit": 100
  }
}
```

**使用示例** - 过滤查询:
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "filter_spec": {
      "conjunction": "CONJUNCTION_AND",
      "conditions": [
        {
          "field_id": "f1gHSR",
          "field_type": "FIELD_TYPE_TEXT",
          "operator": "OPERATOR_CONTAINS",
          "string_value": {
            "value": ["张三"]
          }
        }
      ]
    }
  }
}
```

**返回示例**:
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "total": 10,
  "has_more": false,
  "next": 10,
  "ver": 5,
  "records": [
    {
      "record_id": "re9IqD",
      "values": {
        "姓名": [{"type": "text", "text": "张三"}],
        "年龄": 25,
        "部门": [{"type": "text", "text": "技术部"}],
        "入职日期": "1704067200000",
        "是否全职": [true]
      }
    },
    {
      "record_id": "rpS0P9",
      "values": {
        "姓名": [{"type": "text", "text": "李四"}],
        "年龄": 28,
        "部门": [{"type": "text", "text": "产品部"}],
        "入职日期": "1704153600000",
        "是否全职": [true]
      }
    }
  ]
}
```

**注意**: 实际 API 返回的数据格式可能因字段类型而异，插件会自动规范化处理。

**⚠️ 重要注意事项**:
1. **字段值格式因类型而异** - 数字/日期类型是直接值，文本/成员/选项类型是数组
2. **文本类型带 type 字段** - `[{"type": "text", "text": "内容"}]`
3. **数字类型直接是数字** - `25`、`15000.50`（不是数组）
4. **日期类型是毫秒时间戳字符串** - `"1704067200000"`（不是数组）
5. **选项类型需要 id** - `[{"id": "opt1", "text": "选项", "style": 1}]`
6. **成员类型需要 user_id** - `[{"user_id": "zhangsan"}]`

**过滤操作符 (Operator)**:

| 操作符 | 说明 |
|--------|------|
| OPERATOR_IS | 等于 |
| OPERATOR_IS_NOT | 不等于 |
| OPERATOR_CONTAINS | 包含 |
| OPERATOR_DOES_NOT_CONTAIN | 不包含 |
| OPERATOR_IS_GREATER | 大于 |
| OPERATOR_IS_GREATER_OR_EQUAL | 大于或等于 |
| OPERATOR_IS_LESS | 小于 |
| OPERATOR_IS_LESS_OR_EQUAL | 小于或等于 |
| OPERATOR_IS_EMPTY | 为空 |
| OPERATOR_IS_NOT_EMPTY | 不为空 |

**过滤条件 conjunction**:
- `CONJUNCTION_AND` - 多个条件之间以 and 连接
- `CONJUNCTION_OR` - 多个条件之间以 or 连接

### 5.21 获取子表权限
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_sheet_priv",
  "description": "获取智能表格子表权限规则",
  "parameters": {
    "docId": "文档 ID",
    "type": "1(全员权限)|2(额外权限)",
    "rule_id_list": "可选：规则 ID 列表"
  }
}
```

### 5.22 更新子表权限
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_sheet_priv",
  "description": "更新子表权限规则",
  "parameters": {
    "docId": "文档 ID",
    "type": "1(全员权限)|2(额外权限)",
    "rule_id": "可选：规则 ID",
    "name": "可选：规则名称",
    "priv_list": "权限列表"
  }
}
```

### 5.23 创建权限规则
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_create_rule",
  "description": "创建成员额外权限规则",
  "parameters": {
    "docId": "文档 ID",
    "name": "规则名称"
  },
  "returns": {
    "rule_id": "生成的规则 ID"
  }
}
```

### 5.24 修改规则成员
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_mod_rule_member",
  "description": "修改权限规则的成员范围",
  "parameters": {
    "docId": "文档 ID",
    "rule_id": "规则 ID",
    "add_member_range": "可选：添加成员范围",
    "del_member_range": "可选：删除成员范围"
  }
}
```

### 5.25 删除规则
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_delete_rule",
  "description": "删除权限规则",
  "parameters": {
    "docId": "文档 ID",
    "rule_id_list": ["规则 ID 列表"]
  }
}
```

---

## 六、收集表操作 (Form/Collect Operations)

### 6.1 创建收集表
```json
{
  "name": "wecom_doc",
  "action": "create_form",
  "description": "创建收集表（表单）",
  "parameters": {
    "formInfo": {
      "form_title": "收集表标题（必填）",
      "form_desc": "可选：收集表描述",
      "form_header": "可选：背景图链接",
      "form_question": {
        "items": [
          {
            "question_id": 1,
            "title": "问题标题",
            "pos": 1,
            "status": 1,
            "reply_type": 1,
            "must_reply": true,
            "option_item": [{"key": 1, "value": "选项", "status": 1}]
          }
        ]
      },
      "form_setting": {
        "fill_out_auth": 0,
        "allow_multi_fill": false,
        "can_anonymous": false
      }
    },
    "spaceId": "可选：空间 ID",
    "fatherId": "可选：父目录 fileid"
  },
  "returns": {
    "formId": "收集表 ID",
    "title": "收集表标题"
  }
}
```

### 6.2 编辑收集表
```json
{
  "name": "wecom_doc",
  "action": "modify_form",
  "description": "编辑收集表（全量修改问题或设置）",
  "parameters": {
    "oper": "1(全量修改问题)|2(全量修改设置)",
    "formId": "收集表 ID",
    "formInfo": {
      "form_title": "可选：新标题",
      "form_question": { "items": [...] },
      "form_setting": {...}
    }
  }
}
```

### 6.3 获取收集表信息
```json
{
  "name": "wecom_doc",
  "action": "get_form_info",
  "description": "获取收集表详细信息",
  "parameters": {
    "formId": "收集表 ID"
  },
  "returns": {
    "form_info": {
      "formid": "收集表 ID",
      "form_title": "标题",
      "form_question": { "items": [...] },
      "form_setting": {...},
      "repeated_id": ["周期 ID 列表"]
    }
  }
}
```

### 6.4 获取收集表答案
```json
{
  "name": "wecom_doc",
  "action": "get_form_answer",
  "description": "获取收集表提交的答案（最多 100 个）",
  "parameters": {
    "repeatedId": "收集表周期 ID",
    "answerIds": "可选：答案 ID 列表（最多 100 个）"
  },
  "returns": {
    "answer_list": [
      {
        "answer_id": 15,
        "user_name": "张三",
        "reply": {
          "items": [
            { "question_id": 1, "text_reply": "答案" }
          ]
        }
      }
    ]
  }
}
```

### 6.5 获取收集表统计
```json
{
  "name": "wecom_doc",
  "action": "get_form_statistic",
  "description": "获取收集表统计信息",
  "parameters": {
    "requests": [
      {
        "repeated_id": "周期 ID",
        "req_type": 1,
        "start_time": 1667395287,
        "end_time": 1668418369,
        "limit": 20,
        "cursor": 1
      }
    ]
  },
  "returns": {
    "fill_cnt": 10,
    "fill_user_cnt": 8,
    "unfill_user_cnt": 5,
    "submit_users": [...],
    "unfill_users": [...]
  }
}
```

---

## 七、高级账号管理 (Advanced Account Management)

### 7.1 分配高级功能账号
```json
{
  "name": "wecom_doc",
  "action": "doc_assign_advanced_account",
  "description": "分配文档高级功能账号",
  "parameters": {
    "userid_list": ["成员 ID 列表"]
  },
  "returns": {
    "jobid": "任务 ID"
  }
}
```

### 7.2 取消高级功能账号
```json
{
  "name": "wecom_doc",
  "action": "doc_cancel_advanced_account",
  "description": "取消文档高级功能账号",
  "parameters": {
    "userid_list": ["成员 ID 列表"]
  },
  "returns": {
    "jobid": "任务 ID"
  }
}
```

### 7.3 获取高级账号列表
```json
{
  "name": "wecom_doc",
  "action": "doc_get_advanced_account_list",
  "description": "获取高级功能账号列表",
  "parameters": {
    "cursor": "可选：分页游标",
    "limit": "可选：每页数量"
  },
  "returns": {
    "user_list": [...],
    "has_more": "是否还有更多"
  }
}
```

---

## 八、字段类型对照表 (Field Type Reference)

### 智能表格字段类型 (FieldType)

| 类型值 | 说明 | 对应 property |
|--------|------|--------------|
| FIELD_TYPE_TEXT | 文本 | - |
| FIELD_TYPE_NUMBER | 数字 | property_number |
| FIELD_TYPE_CHECKBOX | 复选框 | property_checkbox |
| FIELD_TYPE_DATE_TIME | 日期 | property_date_time |
| FIELD_TYPE_IMAGE | 图片 | - |
| FIELD_TYPE_ATTACHMENT | 文件 | property_attachment |
| FIELD_TYPE_USER | 成员 | property_user |
| FIELD_TYPE_URL | 超链接 | property_url |
| FIELD_TYPE_SELECT | 多选 | property_select |
| FIELD_TYPE_SINGLE_SELECT | 单选 | property_single_select |
| FIELD_TYPE_CREATED_USER | 创建人 | - |
| FIELD_TYPE_MODIFIED_USER | 最后编辑人 | - |
| FIELD_TYPE_CREATED_TIME | 创建时间 | property_created_time |
| FIELD_TYPE_MODIFIED_TIME | 最后编辑时间 | property_modified_time |
| FIELD_TYPE_PROGRESS | 进度 | property_progress |
| FIELD_TYPE_PHONE_NUMBER | 电话 | - |
| FIELD_TYPE_EMAIL | 邮件 | - |
| FIELD_TYPE_REFERENCE | 关联 | property_reference |
| FIELD_TYPE_LOCATION | 地理位置 | property_location |
| FIELD_TYPE_CURRENCY | 货币 | property_currency |
| FIELD_TYPE_WWGROUP | 群 | property_ww_group |
| FIELD_TYPE_AUTONUMBER | 自动编号 | property_auto_number |
| FIELD_TYPE_PERCENTAGE | 百分数 | property_percentage |
| FIELD_TYPE_BARCODE | 条码 | property_barcode |

### 收集表问题类型 (reply_type)

| 类型值 | 说明 |
|--------|------|
| 1 | 文本 |
| 2 | 单选 |
| 3 | 多选 |
| 5 | 位置 |
| 9 | 图片 |
| 10 | 文件 |
| 11 | 日期 |
| 14 | 时间 |
| 15 | 下拉列表 |
| 16 | 体温 |
| 17 | 签名 |
| 18 | 部门 |
| 19 | 成员 |
| 22 | 时长 |

---

## 九、使用示例 (Usage Examples)

### 示例 1：创建文档并添加协作者
```json
{
  "name": "wecom_doc",
  "action": "create",
  "parameters": {
    "docName": "项目计划",
    "docType": "doc",
    "collaborators": [{"userid": "zhangsan"}, {"userid": "lisi"}],
    "init_content": [
      {"type": "text", "content": "项目计划文档"},
      {"type": "text", "content": "一、项目目标"},
      {"type": "text", "content": "二、项目进度"}
    ]
  }
}
```

### 示例 2：批量更新文档内容
```json
{
  "name": "wecom_doc",
  "action": "update_content",
  "parameters": {
    "docId": "DOCID123",
    "requests": [
      {"replace_text": {"text": "新标题", "ranges": [{"start_index": 0, "length": 5}]}},
      {"insert_text": {"text": "新增段落", "location": {"index": 10}}},
      {"insert_image": {"image_id": "https://...", "location": {"index": 20}}}
    ]
  }
}
```

### 示例 3：智能表格添加记录
```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_records",
  "parameters": {
    "docId": "DOCID456",
    "sheetId": "SHEET789",
    "records": [
      {
        "values": {
          "姓名": [{"type": "text", "text": "张三"}],
          "年龄": 25,
          "部门": [{"type": "text", "text": "技术部"}]
        }
      }
    ]
  }
}
```

### 示例 4：创建收集表
```json
{
  "name": "wecom_doc",
  "action": "create_form",
  "parameters": {
    "formInfo": {
      "form_title": "员工满意度调查",
      "form_question": {
        "items": [
          {
            "question_id": 1,
            "title": "您的部门",
            "pos": 1,
            "reply_type": 15,
            "must_reply": true,
            "option_item": [
              {"key": 1, "value": "技术部"},
              {"key": 2, "value": "产品部"},
              {"key": 3, "value": "市场部"}
            ]
          },
          {
            "question_id": 2,
            "title": "满意度评分",
            "pos": 2,
            "reply_type": 2,
            "must_reply": true,
            "option_item": [
              {"key": 1, "value": "非常满意"},
              {"key": 2, "value": "满意"},
              {"key": 3, "value": "一般"},
              {"key": 4, "value": "不满意"}
            ]
          }
        ]
      }
    }
  }
}
```

---

## 九、智能表格完整使用流程 (Smart Table Complete Workflow)

### 步骤 1：创建智能表格

```json
{
  "name": "wecom_doc",
  "action": "create",
  "parameters": {
    "docName": "员工信息表",
    "docType": "smart_table"
  }
}
```

**返回**:
```json
{
  "docId": "DOCID123",
  "url": "https://doc.weixin.qq.com/smart_table/DOCID123",
  "title": "员工信息表",
  "resourceType": "10"
}
```

---

### 步骤 2：添加自定义字段

```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_fields",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "fields": [
      {
        "field_title": "姓名",
        "field_type": "FIELD_TYPE_TEXT"
      },
      {
        "field_title": "年龄",
        "field_type": "FIELD_TYPE_NUMBER",
        "property_number": {
          "decimal_places": 0,
          "use_separate": false
        }
      },
      {
        "field_title": "部门",
        "field_type": "FIELD_TYPE_SELECT",
        "property_select": {
          "is_quick_add": true,
          "options": [
            {"text": "技术部", "style": 1},
            {"text": "产品部", "style": 2},
            {"text": "市场部", "style": 3}
          ]
        }
      },
      {
        "field_title": "入职日期",
        "field_type": "FIELD_TYPE_DATE_TIME",
        "property_date_time": {
          "format": "yyyy-mm-dd",
          "auto_fill": false
        }
      },
      {
        "field_title": "工资",
        "field_type": "FIELD_TYPE_NUMBER",
        "property_number": {
          "decimal_places": 2,
          "use_separate": true
        }
      },
      {
        "field_title": "是否全职",
        "field_type": "FIELD_TYPE_CHECKBOX",
        "property_checkbox": {
          "checked": true
        }
      }
    ]
  }
}
```

---

### 步骤 3：添加记录

```json
{
  "name": "wecom_doc",
  "action": "smartsheet_add_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "key_type": "CELL_VALUE_KEY_TYPE_FIELD_TITLE",
    "records": [
      {
        "values": {
          "姓名": [{"type": "text", "text": "张三"}],
          "年龄": 25,
          "部门": [{"text": "技术部", "style": 1}],
          "入职日期": "1704067200000",
          "工资": 15000.50,
          "是否全职": [true]
        }
      }
    ]
  }
}
```

**⚠️ 关键格式说明**:
1. **数字/日期类型直接写值** - `25`、`"1704067200000"`、`15000.50`
2. **文本类型必须带 type** - `[{"type": "text", "text": "张三"}]`
3. **选项类型（单选/多选）**：
   - 新增选项：`[{"text": "技术部", "style": 1}]`（不需要 id）
   - 使用已有选项：`[{"id": "选项 ID"}]`
4. **日期类型是毫秒时间戳字符串** - `"1704067200000"`（不是数组）
5. **values 的 key 必须与字段标题完全匹配**（如果 `key_type` 为 `CELL_VALUE_KEY_TYPE_FIELD_TITLE`）

---

### 步骤 4：查询记录

```json
{
  "name": "wecom_doc",
  "action": "smartsheet_get_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "offset": 0,
    "limit": 100
  }
}
```

**返回**:
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "total": 2,
  "has_more": false,
  "records": [
    {
      "record_id": "re9IqD",
      "values": {
        "姓名": [{"type": "text", "text": "张三"}],
        "年龄": 25,
        "部门": [{"id": "opt1", "text": "技术部", "style": 1}],
        "入职日期": "1704067200000",
        "工资": 15000.50,
        "是否全职": [true]
      }
    },
    {
      "record_id": "rpS0P9",
      "values": {
        "姓名": [{"type": "text", "text": "李四"}],
        "年龄": 28,
        "部门": [{"id": "opt2", "text": "产品部", "style": 2}],
        "入职日期": "1704153600000",
        "工资": 18000.00,
        "是否全职": [true]
      }
    }
  ]
}
```

---

### 步骤 5：更新记录

```json
{
  "name": "wecom_doc",
  "action": "smartsheet_update_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "records": [
      {
        "record_id": "re9IqD",
        "values": {
          "姓名": [{"type": "text", "text": "张三丰"}],
          "工资": 16000.00
        }
      }
    ]
  }
}
```

---

### 步骤 6：删除记录

```json
{
  "name": "wecom_doc",
  "action": "smartsheet_del_records",
  "parameters": {
    "docId": "DOCID123",
    "sheetId": "SHEET456",
    "record_ids": ["rpS0P9"]
  }
}
```

---

## 十、注意事项 (Important Notes)

### 1. 批量操作限制
- **文档批量更新**：最多 30 个操作
- **表格批量更新**：最多 5 个操作
- **收集表答案查询**：最多 100 个答案 ID
- **智能表格字段操作**：单次可添加/更新/删除多个字段
- **智能表格记录操作**：单次添加/删除建议在 500 行内

### 2. 版本控制
- **更新文档内容时**：version 与最新版差值不能超过 100
- **建议**：每次更新前获取最新文档内容

### 3. 权限说明
- **自建应用**：需配置到"可调用应用"列表
- **第三方应用**：需具有"文档"权限
- **代开发自建应用**：需具有"文档"权限
- **只能操作**：该应用创建的文档

### 4. 智能表格字段类型匹配
- **添加/更新字段时**：field_type 必须与 property_* 属性匹配
- **更新字段时**：不能修改字段类型
- **一种字段类型对应一种字段属性**

### 5. 智能表格记录格式（⚠️ 重要）

#### 5.1 字段值格式因类型而异
不同字段类型的值格式不同：
- **数字/日期/货币/进度/百分数类型**：直接写值，不需要数组
  - ✅ 正确：`25`、`"1704067200000"`、`15000.50`、`0.75`
  - ❌ 错误：`[25]`、`["1704067200000"]`、`[15000.50]`、`[0.75]`
- **文本/成员/选项/复选框/电话/邮箱/链接/条码/地理位置类型**：必须用数组
  - ✅ 正确：`[{"type": "text", "text": "内容"}]`、`[{"user_id": "zhangsan"}]`、`[true]`
  - ❌ 错误：`{"type": "text", "text": "内容"}`、`{"user_id": "zhangsan"}`、`true`

#### 5.2 各类型字段值格式详解

| 字段类型 | 值格式 | 示例 |
|----------|--------|------|
| 文本 (FIELD_TYPE_TEXT) | object[] | `[{"type": "text", "text": "张三"}]` |
| 数字 (FIELD_TYPE_NUMBER) | number | `25`、`15000.50` |
| 日期 (FIELD_TYPE_DATE_TIME) | string | `"1704067200000"`（毫秒时间戳） |
| 复选框 (FIELD_TYPE_CHECKBOX) | boolean[] | `[true]`、`[false]` |
| 多选 (FIELD_TYPE_SELECT) | object[] | 新增：`[{"text": "选项", "style": 1}]`，已有：`[{"id": "选项 ID"}]` |
| 单选 (FIELD_TYPE_SINGLE_SELECT) | object[] | 新增：`[{"text": "选项", "style": 1}]`，已有：`[{"id": "选项 ID"}]` |
| 成员 (FIELD_TYPE_USER) | object[] | `[{"user_id": "zhangsan"}]` |
| 进度 (FIELD_TYPE_PROGRESS) | number | `0.75`（0-1 之间） |
| 电话 (FIELD_TYPE_PHONE_NUMBER) | string[] | `["13800138000"]` |
| 邮箱 (FIELD_TYPE_EMAIL) | string[] 或 object[] | `["test@example.com"]` 或 `[{"type": "url", "text": "test@example.com", "link": "mailto:test@example.com"}]` |
| 链接 (FIELD_TYPE_URL) | object[] | `[{"type": "url", "text": "显示文本", "link": "https://..."}]` |
| 货币 (FIELD_TYPE_CURRENCY) | number | `100.50` |
| 百分数 (FIELD_TYPE_PERCENTAGE) | number | `0.75`（表示 75%） |
| 条码 (FIELD_TYPE_BARCODE) | string[] | `["6901234567890"]` |
| 地理位置 (FIELD_TYPE_LOCATION) | object[] | `[{"id": "地点 ID", "latitude": "23.10647", "longitude": "113.32446", "title": "广州塔", "source_type": 1}]` |

#### 5.3 文本类型值的 type 字段
- `text` - 普通文本内容
- `url` - 链接文本（需要同时提供 `link` 字段）

#### 5.4 选项类型（单选/多选）的填写规则
- **新增选项**：`{"text": "选项内容", "style": 颜色编号 (1-27)}`
- **使用已有选项**：`{"id": "已有选项 ID"}`
- **系统会优先匹配已有选项**，如果匹配不到则新增选项

#### 5.5 不能添加/更新的字段类型
以下字段类型由系统自动填充，不能通过接口添加或更新：
- 创建时间 (FIELD_TYPE_CREATED_TIME)
- 最后编辑时间 (FIELD_TYPE_MODIFIED_TIME)
- 创建人 (FIELD_TYPE_CREATED_USER)
- 最后编辑人 (FIELD_TYPE_MODIFIED_USER)

### 6. 智能表格限制
- **单表最多 100000 行记录**
- **单表最多 1500000 个单元格**
- **单表最多 150 个字段**
- **单表最多 200 个视图**
- **单次添加/更新/删除记录建议在 500 行内**

### 7. key_type 参数
- **CELL_VALUE_KEY_TYPE_FIELD_TITLE**（默认）- 使用字段标题作为 values 的 key
- **CELL_VALUE_KEY_TYPE_FIELD_ID** - 使用字段 ID 作为 values 的 key
- **添加记录和查询记录时都要注意保持一致**

### 8. 常见错误排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 数据都填充到一列 | values 的 key 不是字段标题或字段 ID | 检查 key_type 设置，确保 key 与字段标题或字段 ID 完全匹配（包括空格和大小写） |
| 多余的行 | records 数组格式错误 | 确保 records 是数组，每个记录是独立对象 `[{values: {...}}, {values: {...}}]` |
| 无法添加自定义字段 | field_type 或 property 不匹配 | 检查字段类型与属性的对应关系，见字段类型对照表 |
| 无法修改默认字段 | 尝试修改系统字段 | 创建时间、最后编辑时间、创建人、最后编辑人不能通过接口修改 |
| 添加记录失败 | 值格式错误 | 数字/日期类型直接写值，文本/成员等类型用数组，插件会自动规范化 |
| 日期字段错误 | 使用了秒级时间戳或日期字符串 | 使用毫秒级时间戳字符串 `"1704067200000"` 而不是 `1704067200000` 或 `"2024-01-01"` |
| 选项字段错误 | 格式错误或缺少必要字段 | 新增选项：`[{"text": "选项", "style": 1}]`，使用已有：`[{"id": "选项 ID"}]` |
| 单选字段添加失败 | 使用了错误的格式 | 单选和多选格式相同，都是 Option 对象数组 |
| 文本字段添加失败 | 缺少 type 字段 | 文本类型必须是 `[{"type": "text", "text": "内容"}]` 格式 |
| 链接字段添加失败 | 格式错误 | 链接类型必须是 `[{"type": "url", "text": "文本", "link": "URL"}]` 格式 |

---

**文档版本**: 2026-03-18 v2  
**适用版本**: OpenClaw WeChat Plugin v2.3.16+  
**官方文档**: 企业微信开放平台 - 文档 API

---

## 修正记录 (Revision History)

### 2026-03-18 v2 - 智能表格记录格式修正

#### 修复的问题：

1. **选项字段格式错误** ❌ → ✅
   - **问题**：单选/多选字段使用了错误的格式 `[{"id": "opt1", "text": "选项", "style": 1}]`
   - **原因**：混淆了新增选项和使用已有选项的格式
   - **修正**：
     - 新增选项：`[{"text": "选项内容", "style": 颜色编号}]`（不需要 id）
     - 使用已有选项：`[{"id": "已有选项 ID"}]`（只需要 id）
   - **官方文档依据**：doc2.txt 第 1747-1757 行 Option 说明

2. **日期字段格式说明不清晰** ❌ → ✅
   - **问题**：没有强调必须是毫秒时间戳字符串
   - **修正**：明确指出使用 `"1704067200000"` 格式（字符串），不是数字 `1704067200000`
   - **官方文档依据**：doc2.txt 第 1679 行

3. **添加完整的值格式对照表** ❌ → ✅
   - **问题**：缺少 15 种字段类型的完整值格式说明
   - **修正**：添加详细的表格，包含每种类型的正确格式和示例

4. **常见错误排查不完善** ❌ → ✅
   - **问题**：缺少单选字段、文本字段、链接字段等错误排查
   - **修正**：添加 10 种常见错误及解决方案

5. **使用示例优化** ❌ → ✅
   - **问题**：示例中的选项字段格式不正确
   - **修正**：更新所有示例，使用正确的选项格式

#### 新增内容：

1. **15 种字段类型的值格式对照表** - 包含所有支持的字段的值格式
2. **文本类型 type 字段说明** - text 和 url 的区别
3. **选项类型填写规则** - 新增选项 vs 使用已有选项
4. **10 种常见错误排查** - 覆盖所有常见问题
5. **完整使用流程示例** - 6 步完整示例，格式完全正确

#### 关键修正点：

| 字段类型 | 原格式（错误） | 新格式（正确） |
|----------|---------------|---------------|
| 单选/多选（新增） | `[{"id": "opt1", "text": "选项", "style": 1}]` | `[{"text": "选项", "style": 1}]` |
| 单选/多选（已有） | `[{"text": "选项"}]` | `[{"id": "选项 ID"}]` |
| 日期 | `[1704067200000]` 或 `["2024-01-01"]` | `"1704067200000"` |
| 文本 | `{"type": "text", "text": "内容"}` | `[{"type": "text", "text": "内容"}]` |

---

### 2026-03-19 v2 - 智能表格记录格式修正

#### 修复的问题：

1. **数字/日期类型值格式错误** ❌ → ✅
   - **问题**：文档示例中数字和日期类型使用了数组格式
   - **原因**：实际 API 测试表明数字和日期类型应该直接写值
   - **修正**：明确字段值格式因类型而异
     - 数字/货币/进度/百分数：直接写值 `25`、`15000.50`、`0.75`
     - 日期：直接写毫秒时间戳字符串 `"1704067200000"`
     - 文本/成员/选项/复选框等：使用数组 `[{"type": "text", "text": "内容"}]`、`[{"user_id": "xxx"}]`
   - **插件自动规范化**：如果传入格式不正确，插件会自动转换

---

### 2026-03-18 v1 - 初始重大修正

#### 修复的问题：

1. **添加记录数据格式错误** ❌ → ✅
   - **问题**：数据格式不正确，导致所有数据填充到一列
   - **原因**：没有明确说明不同字段类型的值格式差异
   - **修正**：明确字段值格式因类型而异
     - 文本：`[{"type": "text", "text": "内容"}]`
     - 数字：`25`（直接值，不是数组）
     - 日期：`"1704067200000"`（毫秒时间戳字符串，不是数组）
     - 选项：`[{"id": "opt1", "text": "选项", "style": 1}]`

2. **缺少字段类型与值类型对照表** ❌ → ✅
   - **问题**：没有明确说明每种字段类型对应的值格式
   - **修正**：添加完整的字段类型与值类型对照表
   - **包含**：文本、数字、日期、多选、单选、成员、复选框、进度、电话、邮箱、链接、货币、百分数、条码、地理位置

3. **添加字段属性不完整** ❌ → ✅
   - **问题**：缺少各种字段类型的属性说明
   - **修正**：添加所有 22 种字段类型的属性说明
   - **包含**：property_number、property_checkbox、property_date_time 等

4. **更新记录说明不清晰** ❌ → ✅
   - **问题**：没有明确说明不能更新的字段类型
   - **修正**：明确指出创建时间、最后编辑时间、创建人、最后编辑人不能更新

5. **查询记录返回格式不明确** ❌ → ✅
   - **问题**：没有说明返回的 values 格式
   - **修正**：添加完整的返回示例，展示正确的 values 格式

6. **缺少完整使用流程** ❌ → ✅
   - **问题**：没有从创建到使用的完整示例
   - **修正**：添加 6 步完整使用流程（创建→添加字段→添加记录→查询→更新→删除）

7. **常见错误排查缺失** ❌ → ✅
   - **问题**：遇到问题时无法快速定位
   - **修正**：添加常见错误排查表格，包含问题、原因、解决方案

#### 新增内容：

1. **智能表格完整使用流程** - 6 步完整示例
2. **字段类型与值类型对照表** - 15 种字段类型的值格式
3. **字段类型与属性对照表** - 22 种字段类型的属性说明
4. **过滤操作符对照表** - 10 种操作符说明
5. **常见错误排查表** - 7 种常见问题及解决方案
6. **key_type 参数说明** - 明确两种 key 类型的区别

#### 优化内容：

1. **参数说明标准化** - 所有参数都标注了必填/可选、类型、说明
2. **使用示例丰富化** - 每个接口都有多个使用示例
3. **注意事项分类化** - 按主题分类，便于查找
4. **返回值完整化** - 所有接口都有完整的返回值说明
