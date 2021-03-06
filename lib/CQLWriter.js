var Schema = require('./Schema');

module.exports = require('clss').create('CQLWriter', function (def) {
  def.init = function (schema) {
    this.schema = schema;

    return this;
  };


  def.primaryKeys = function () {
    return this.schema.info.primaryKeys;
  };

  def.tableName = function () {
    return this.schema.info.tableName;
  };

  def.tableFields = function () {
    return this.schema.info.fields;
  };

  def.tableField = function (name) {
    return this.tableFields()[name];
  };


  def.escapeName = function (name) {
    return '"' + name + '"';
  };


  def.byId = function (id) {
    var where = {};

    if (!Array.isArray(id)) id = [id];

    this.schema.info.primaryKeys.forEach(function (key, i) {
      where[key] = id[i];
    });

    return where;
  };

  def.createKeyspace3 = function (name, strategy, options) {
    options = options || {};
    if (!options['class']) {
      options['class'] = "SimpleStrategy";
      if (!options.replication_factor)
        options.replication_factor = 1;
    }
    function optionsStringify(options) {
      return "{" + Object.keys(options).map(function (option) {
        return  "'" + option + "': " + JSON.stringify(options[option]).replace(/"/g, "'");
      }) + "}";
    }
    return 'CREATE KEYSPACE ' + this.escapeName(name) +
           ' WITH replication = ' + optionsStringify(options) + ' AND DURABLE_WRITES = true';
  };
  
  def.createKeyspace = function (name, strategy, options) {
    strategy = strategy || 'SimpleStrategy';

    if (!options) {
      options = {};
    }
    if (strategy && !options.replication_factor)
      options.replication_factor = 1;
    options = Object.keys(options).map(function (option) {
      var val = options[option];
      return ' AND strategy_options:' + option + " = " + val;
    }).join('');

    return 'CREATE KEYSPACE ' + this.escapeName(name) +
           ' WITH strategy_class=' + strategy + options + ';';
  };

  def.createTable = function (name, fields, primaries, options) {
    name = name ? this.escapeName(name) : this.escapeName(this.tableName());

    return 'CREATE TABLE ' + name +
           ' (' + this.propertiesSQL(fields, primaries) + ')' +
           this.withOptions(options || this.schema.info.tableOptions) + ';';
  };

  def.createIndex = function (name, indexName) {
    return 'CREATE INDEX ' + (indexName || '') + ' ON ' + this.escapeName(this.tableName()) + '(' + this.escapeName(name) + ');';
  };


  def.insert = function (data, options) {
    var fields = this.getFields(data);

    if (!fields.names.length) return '';

    return 'INSERT INTO ' + this.escapeName(this.tableName()) +
           ' (' + fields.names.join(', ') +  ')' +
           ' VALUES (' + fields.values.join(', ') + ')' +
           this.usingOptions(options) + ';';
  };


  def.select = function (expr, filter, consistency) {
    if (!filter && typeof expr === 'object') {
      filter = expr;
      expr = null;
    }

    var cql = 'SELECT ' + (expr || '*') + ' FROM ' + this.escapeName(this.tableName());

    if (consistency) {
      cql += ' USING CONSISTENCY ' + consistency;
      debugger;
    }

    if (filter) {
      if (filter.where) cql += this.where(filter.where);
      if (filter.order) cql += this.order(filter.order);
      if (filter.limit) cql += this.limit(filter.limit, filter.offset || 0);
      if (this.schema.allowFiltering) cql += " ALLOW FILTERING";
    }

    return cql + ';';
  };

  def.selectAll = function (filter, consistency) {
    return this.select('*', filter, consistency);
  };

  def.selectOne = function (conds, order, offset, consistency) {
    return this.selectAll({where: conds, limit: 1, order: order, offset: offset, allowFiltering: this.schema.allowFiltering}, consistency);
  };

  def.selectById = function (id, consistency) {
    return this.selectOne(this.byId(id), null, null, consistency);
  };


  def.count = function (conds, limit, offset, consistency) {
    return this.select('COUNT(*)', {where: conds, limit: limit, offset: offset}, consistency);
  };


  def.update = function (data, conds, options) {
    var fields = this.getFields(data),
        self = this,
        sets = fields.names.map(setField).filter(function (e) { return e != null; }),
        cql = 'UPDATE ' + this.escapeName(this.tableName());

    function setField(name, i) {
      var isKey = (name === 'id') || (self.schema.info.fields[name] && self.schema.info.fields[name].primary_key) || (self.schema.info.primaryKeys.indexOf(name) != -1);
      if (isKey)
        return null;
      return self.escapeName(name) + '=' + fields.values[i];
    }

    if (!sets.length) return '';

    options = this.usingOptions(options);

    if (options) cql += options + ';';

    return cql + ' SET ' + sets.join(', ') + this.where(conds) + ';';
  };

  def.updateById = function (data, id, options) {
    return this.update(data, this.byId(id), options);
  }


  def.destroy = function (columns, conds, options) {
    columns = (columns || []).map(this.escapeName.bind(this));

    return 'DELETE ' + columns.join(',') + ' FROM ' + this.escapeName(this.tableName()) +
           this.usingOptions(options) + this.where(conds) + ';';
  };

  def.destroyAll = function (conds, options) {
    return this.destroy([], conds, options);
  };

  def.destroyById = function (id, options) {
    return this.destroyAll(this.byId(id), options);
  };


  def.use = function (name) {
    return 'USE ' + this.escapeName(name) + ';';
  };


  def.batch = function (statements, options) {
    var cql = 'BEGIN BATCH\n';

    options = this.usingOptions(options);

    if (options) cql += options + ';';

    cql += statements.join('\n');

    return cql + '\nAPPLY BATCH;';
  };


  def.truncate = function (name, keyspace) {
    name = name ? this.escapeName(name) : this.escapeName(this.tableName());

    return 'TRUNCATE ' + (keyspace ? this.escapeName(keyspace) + '.' : '') + name + ';';
  };


  def.alterTable = function (changes, name, keyspace) {
    if (!changes) return '';

    name = name ? this.escapeName(name) : this.escapeName(this.tableName());
    keyspace = keyspace ? this.escapeName(keyspace) + '.' : '';

    var statements = [],
        alterTable = 'ALTER TABLE ' + keyspace + name;

    if (changes.alters) changes.alters.forEach(function (alter) {
      statements.push(alterTable + ' ALTER ' + this.escapeName(alter.name) +
                      ' TYPE ' + this.schema.fixDataType(alter.type));
    }.bind(this));

    if (changes.drops) changes.drops.forEach(function (drop) {
      statements.push(alterTable + ' DROP ' + this.escapeName(drop));
    }.bind(this));

    if (changes.adds) changes.adds.forEach(function (add) {
      statements.push(alterTable + ' ADD ' + this.escapeName(add.name) +
                      ' ' + this.schema.fixDataType(add.type));
    }.bind(this));

    if (changes.options) statements.push(alterTable + this.withOptions(changes.options));

    if (!statements.length) return '';

    return statements;
  };


  def.dropKeyspace = function (name) {
    return 'DROP KEYSPACE ' + this.escapeName(name) + ';';
  };

  def.dropTable = function (name) {
    return 'DROP TABLE ' + (name ? this.escapeName(name) : this.escapeName(this.tableName())) + ';';
  };

  def.dropIndex = function (name, noIdx) {
    return 'DROP INDEX ' + this.escapeName(this.tableName() + '_' + name + (noIdx ? '' : '_idx')) + ';';
  };


  def.propertiesSQL = function (fields, keys) {
    fields = fields || this.tableFields();
    keys = keys || this.schema.info.primaryKeys;
    partitionCount = this.schema.info.partitionKeys || 0;
    
    var cql = [];

    if (keys.length === 1) cql.push(this.propertySQL(keys[0]) + ' PRIMARY KEY');

    else keys.forEach(function (key) {
      cql.push(this.propertySQL(key));
    }.bind(this));

    Object.keys(this.tableFields()).forEach(function (name) {
      if (/^_.*/.test(name))
        return;
      if (keys.indexOf(name) === -1) {
        cql.push(this.propertySQL(name, fields));
      }
    }.bind(this));

    if (keys.length > 1) {
      var self = this;
      var list = [];
      keys.forEach(function (e, i) {
        if (partitionCount > 1) {
          if (i == 0)
            list.push('(' + self.escapeName(e));
          else if (i == (partitionCount - 1))
            list.push(self.escapeName(e) + ')');
          else
            list.push(self.escapeName(e));
        } else
          list.push(self.escapeName(e)); 
      });
      cql.push('PRIMARY KEY (' + list.join(', ') + ')');
    }

    return '\n ' + cql.join(',\n ');
  };

  def.propertySQL = function (name, fields) {
    return this.escapeName(name) + ' ' + this.schema.dataType(name, fields);
  };


  def.getFields = function (data) {
    var schema = this.schema,
        values = [],
        names = [];

    Object.keys(data).forEach(function (name) {
      names.push(name);

      values.push(schema.toDatabase(data[name], name));
    }.bind(this));

    return {names: names, values: values};
  };


  def.where = function (conds) {
    if (!conds) return '';

    var cql = [];
    Object.keys(conds).forEach(function (name) {
      if (typeof conds[name] === "undefined") return;

      var condition = conds[name],
          isArray = Array.isArray(condition),
          value = !isArray && this.schema.toDatabase(condition, name);

      if (Array.isArray(condition)) cql.push(this.escapeName(name) + ' IN (' + condition.map(function (value) {
        return this.schema.toDatabase(value, name);
      }.bind(this)) + ')');

      else if (condition.constructor.name === 'Object') nonEquals.bind(this)(name, condition);

      else if (/^token\(/.test(name))
        cql.push(name + '=' + value);
      else cql.push(this.escapeName(name) + '=' + value);

    }.bind(this));

    if (!cql.length) return '';

    return ' WHERE ' + cql.join(' AND ');

    function nonEquals(name, value) {
      var op;
      var o = Object.keys(conds[name])[0];
      switch (o) {
        case 'gt': op = '>'; break;
        case 'lt': op = '<'; break;
        case 'gte': op = '>='; break;
        case 'lte': op = '<='; break;
      }
      if (/^token\(/.test(name))
        return cql.push(name + op + value[o]);
      else
        return cql.push(this.escapeName(name) + op + this.schema.toDatabase(value[o], name));
    }
  };

  def.order = function (order) {
    return order ? ' ORDER BY ' + this.escapeName(order) : '';
  };

  def.limit = function (limit, offset) {
    return limit ? ' LIMIT ' + (offset ? (offset + ', ' + limit) : limit) : '';
  };


  def.withOptions = function (options) {
    return Array.isArray(options) ? ' WITH ' + options.join(' AND ') : '';
  }

  def.usingOptions = function (options) {
    return Array.isArray(options) ? ' USING ' + options.join(' AND ') : '';
  };
});
