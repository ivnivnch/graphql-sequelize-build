import argsToFindOptions from './argsToFindOptions';
import {isConnection, nodeAST, nodeType} from './relay';
import _ from 'lodash';

const GRAPHQL_NATIVE_KEYS = [
  '__typename',
];

const generateIncludes = (simpleAST, type, context, options = {}) => {
  const result = {include: [], attributes: [], order: []};

  type = type.ofType || type;

  return Promise.all(Object.keys(simpleAST.fields).map((key) => {
    if (GRAPHQL_NATIVE_KEYS.includes(key)) return; // Skip native grahphql keys

    let association
      , fieldAST = simpleAST.fields[key]
      , name = fieldAST.key || key
      , fieldType = type._fields[name] && type._fields[name].type
      , includeOptions
      , args = fieldAST.args
      , includeResolver = type._fields[name] && type._fields[name].resolve
      , allowedAttributes
      , include;

    if (!includeResolver) return;

    if (includeResolver.$proxy) {
      while (includeResolver.$proxy) {
        includeResolver = includeResolver.$proxy;
      }
    }

    if (isConnection(fieldType)) {
      fieldAST = nodeAST(fieldAST);
      fieldType = nodeType(fieldType);
    }

    if (!fieldAST) return; // No point in including if no fields have been asked for

    if (includeResolver.$passthrough) {
      return generateIncludes(
        fieldAST,
        fieldType,
        context,
        options
      ).then((dummyResult) => {
        result.include = result.include.concat(dummyResult.include);
        result.attributes = result.attributes.concat(dummyResult.attributes);
        result.order = result.order.concat(dummyResult.order);
      });
    }

    association = includeResolver.$association;
    include = options.include && !(includeResolver.$options && includeResolver.$options.separate);

    if (association) {
      allowedAttributes = Object.keys(association.target.rawAttributes);
      includeOptions = argsToFindOptions(args, allowedAttributes);
      includeOptions.attributes = allowedAttributes;

      return Promise.resolve().then(() => {
        if (includeResolver.$before) {
          return includeResolver.$before(includeOptions, args, context, {
            ast: fieldAST,
            type: type
          });
        }
        return includeOptions;
      }).then((includeOptions) => {
        if (association.associationType === 'BelongsTo') {
          result.attributes.push(association.foreignKey);
        } else if (association.source.primaryKeyAttribute) {
          result.attributes.push(association.source.primaryKeyAttribute);
        }

        let separate = includeOptions.limit && association.associationType === 'HasMany';

        if (includeOptions.limit) {
          includeOptions.limit = parseInt(includeOptions.limit, 10);
        }

        if (include && (!includeOptions.limit || separate)) {
          if (includeOptions.order && !separate) {
            includeOptions.order.map((order) => {
              order.unshift({
                model: association.target,
                as: association.options.as
              });

              return order;
            });

            result.order = (result.order || []).concat(includeOptions.order);
            delete includeOptions.order;
          }

          if (association.target.primaryKeyAttribute) {
            includeOptions.attributes.push(association.target.primaryKeyAttribute);
          }

          if (association.associationType === 'HasMany') {
            includeOptions.attributes.push(association.foreignKey);
          }

          return generateIncludes(
            fieldAST,
            fieldType,
            context,
            includeResolver.$options
          ).then((nestedResult) => {
            includeOptions.include = (includeOptions.include || []).concat(nestedResult.include);
            includeOptions.attributes = _.uniq(includeOptions.attributes.concat(nestedResult.attributes));

            //build: required option: if set true or undefined && where - INNER JOIN else - LEFT OUTER JOIN
            if (includeResolver.$options && typeof includeResolver.$options.required === 'boolean') {
              includeOptions.required = includeResolver.$options.required;
            }

            //build: alias support
            if (key != name) includeOptions.as = key;

            result.include.push(_.assign({association: association}, includeOptions));
          });
        }
      });
    }
  })).then(() => result);
};

export default generateIncludes;
