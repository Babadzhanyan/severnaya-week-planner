// Выход из поля ввода (Д04): запятая, пустое поле, отрицательное значение, превышение предела и сохранение исходного значения.
import assert from 'node:assert/strict';
import {fieldCommit,n,parseFieldNumber} from '../src/format.js';

// Разбор ввода: запятая и неразрывные пробелы разрешены, мусор – нет.
assert.deepEqual(parseFieldNumber('4,5'),{kind:'number',value:4.5});
assert.deepEqual(parseFieldNumber('4 010'),{kind:'number',value:4010});
assert.deepEqual(parseFieldNumber(' -3 '),{kind:'number',value:-3});
assert.equal(parseFieldNumber('').kind,'empty');
assert.equal(parseFieldNumber('   ').kind,'empty');
assert.equal(parseFieldNumber('4,5,6').kind,'invalid');
assert.equal(parseFieldNumber('1e3').kind,'invalid');

// Исходное значение 4 010 т при пределе 1 000 т: выход из поля не записывает 1 000 и не меняет значение молча.
const over=fieldCommit({text:'4010',current:4010,min:1,max:1000,unit:'т'});
assert.equal(over.kind,'same','Неизмененный ввод 4 010 т не меняет значение');
const typedOver=fieldCommit({text:'2000',current:4010,min:1,max:1000,unit:'т'});
assert.equal(typedOver.kind,'confirm','Превышение предела требует подтверждения');
assert.equal(typedOver.value,2000);
assert.equal(typedOver.apply,1000,'Корректировка предлагается, но не применяется');
assert.match(typedOver.message,/больше допустимого предела/);
assert.ok(typedOver.message.includes(n(1000)),'Причина называет предел');
assert.match(typedOver.applyLabel,/^Ограничить до /);

// Допустимый ввод применяется сразу; запятая дает то же число.
assert.deepEqual(fieldCommit({text:'500',current:4010,min:1,max:1000,unit:'т'}),{kind:'apply',value:500});
assert.deepEqual(fieldCommit({text:'4,5',current:4010,min:1,max:1000,unit:'т'}),{kind:'apply',value:4.5});

// Пустое поле, нечисловой ввод: значение сохраняется, причина показывается.
const empty=fieldCommit({text:'',current:4010,min:1,max:1000,unit:'т'});
assert.equal(empty.kind,'keep');
assert.match(empty.message,/Введите число/);
assert.ok(empty.message.includes(n(4010)),'Сохраненное значение названо в причине');
assert.equal(fieldCommit({text:'abc',current:4010,min:1,max:1000,unit:'т'}).kind,'keep');
// Очищаемое поле (инвестиции, годовые расходы) пустым вводом снимает значение.
assert.deepEqual(fieldCommit({text:'',current:null,clearable:true}),{kind:'clear'});

// Отрицательное значение: предлагается минимум, решение за пользователем.
const negative=fieldCommit({text:'-3',current:10,min:0,max:100,unit:'т'});
assert.equal(negative.kind,'confirm');
assert.equal(negative.apply,0);
assert.match(negative.message,/меньше допустимого минимума/);

// Ввод без предела (значение внутри диапазона и без единицы) не добавляет лишних пробелов.
const plain=fieldCommit({text:'150',current:10,min:0,max:200});
assert.deepEqual(plain,{kind:'apply',value:150});
const noUnit=fieldCommit({text:'300',current:10,min:0,max:200});
assert.equal(noUnit.message,`Значение ${n(300)} больше допустимого предела ${n(200)}`);

console.log('Выход из поля проверен: запятая, пустое поле, отрицательное значение, превышение предела и сохранение 4 010 т');
