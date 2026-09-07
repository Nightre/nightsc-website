---
title: "也许渲染器不需要维护场景树"
description: "我的第一篇文章。"
pubDate: "September 06 2026"
heroImage: "/cover1.png"
lang: "ja"
---

传统的渲染引擎或游戏引擎大多都是先有用户构建的`场景树`再有`矩阵堆栈`，也就是由`持久状态`生成`执行过程`。用户只需要维护`场景树`。这很符合直觉。

不过我认为渲染器不应该持有像`场景树`这样在不同帧之间持久存在的状态，因为这不在它的功能范围内。这是游戏引擎之类的工作。那如果将这个过程反过来。我们让用户使用`矩阵堆栈`来生成“场景树”。使用者则无需维护`场景树`反而维护`矩阵堆栈`。会怎么样呢？

先来看看最古老的`Canvas 2D`，比如玩家拿着武器的场景这样构建它

```js
ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.drawImage(playerImg, player.x, player.y);

    ctx.save();
        ctx.translate(weaponImg.x, weaponImg.y);
        ctx.rotate(weaponImg.angle);
        ctx.drawImage(weaponImg, 0, 0);
    ctx.restore();
ctx.restore();

ctx.drawImage(hpBarImg, 10, 10);
```

这个就是手动操作矩阵堆栈，也就是手动调用`ctx.save`/`ctx.restore`的执行过程来构建场景。这很酷。但是这样会有问题出现，这些问题在场景树里都可以避免：

- 出栈即销毁，一旦 `restore()`，刚刚辛辛苦苦算出来的世界矩阵就灰飞烟灭了。如果游戏逻辑需要用到某个部件的全局坐标，根本无从获取。

- 丢失依赖拓扑关系。系统不知道谁是谁的子节点，无法局部更新。
- 变换与绘制调用被强行锁死在同一时刻。很难自由的做 Y-Sort 等图层排序
- 无法做逆向空间解算，每个节点没有自己的局部坐标系
- 必须用嵌套代码还原空间关系，你的代码调用顺序必须按照父子层级结构

这看起来很多，但是我们可以归纳成两个问题：

- 从时间维度上：矩阵出栈之后消失，代码调用顺序必须按照父子层级结构
- 从空间维度上：丢失父子的拓扑关系，无法局部/按依赖更新

时间维度的问题很简单。只需要在 `save` 的时候保留着这个矩阵。后续在执行 `restore` 时，仅将其从 matrixStack 状态栈中移出，而不销毁或覆盖此前保留的历史矩阵即可

```ts
const world = stack.save();
stack.translate(200, 200);

const enemyNode = stack.save();
stack.translate(80, 0);

stack.restore(); // enemyNode
stack.restore(); // world

rapid.drawSprite({
  texture: enemy,
  customMatrix: enemyNode.world,
});
```

或是直接复制矩阵到当前martixstack顶层

```ts
const enemyNode = stack.save();
matrix.copy(enemyNode, otherNode)
rapid.drawSprite({texture: enemy});
```

但是接下来复杂的问题就来了。我们有了以上的操作。如何确保拓扑关系仍然正确？

`save`/`restore` 产生的拓扑形态 是一个从任意节点沿着走，永远不会经过起点的图。也就是`有向无环图`。那么存储这个结构。只需要把每次`save()`,`restore()`都视作一个step，并在每个 Step 阶段记录当前动作类型及变换矩阵快照。

```ts
// save = 1
// restore = 0

// save()     1  root                   
// save()     1  ├── world              
//               │   ├── player
// save()     1  │   └── enemies          
//               │       ├── enemy #0
//               │       ├── enemy #1
//               │       └── ...
// restore()  0  │                        
// restore()  0  │                        
// restore()  0  └── ui                   

const stepAction = [1, 1, 1, 0, 0, 0]
const stepWorldMatrix = [...]
const steplocalMatrix = [...]
```

基于这样的设计，我们仅通过  `stepAction`, `stepWorldMatrix` 和 `steplocalMatrix`等数个数组，便能以极低的内存开销，完整的记录整个MatrixStack操作的拓扑形态。`stepAction` 也是个场景树。`1`代表更深，`0`代表更浅。也就是说我们用matrixstack的过程创建了一个`场景树`

那么接下来有了节点的依赖，局部更新/更新依赖的子节点就变得十分明确。从当前`step`出发遇到`save`增加深度，遇到`restore`减少深度，什么时候深度再次回到自己相同的深度，那么这个矩阵的作用域就结束了。在路上遇见的每个节点，都重新计算世界矩阵。

```ts
while (index < this.step) {
    const action = this.stepAction.get(index)

    if (action === 1) { // save 
        this.matrix.multiplyOut(worldMatrix, parentMatrix, localMatrix)
        depth++
    } else { // restore
        depth--
        if (depth <= 0) {
            // 作用域结束
            break
        }
    }

    index++
}
```

不过，还有一个问题，在上一章在时间问题的时候我们说过可以直接复制矩阵。有时候`MatrixStack`作用域已经完成退出。
但仍然需要再次使用作用域的节点来构建更深的图怎么办？如何在这种情况下继续保持矩阵依赖关系？

```ts
const enemyNode = stack.save();
matrix.copy(enemyNode, otherNode)
rapid.drawSprite({texture: enemy});
```

用一个`stepFork`链表记录每一个节点被fork的节点即可。1被2分支，2被3分支。当更新 1 的时候。就会按照链表

```ts
const enemyNode = stack.save()
...
frokFrom(enemyNode)


const stepFork =   [2, 3, -1, -1, -1, -1]
const stepMatrix = [1, 2,  3,   4, 5,  6]
```

`rapid.js` 提供了
- `customMatrix`：解决时间维度上的问题
- `updateMatrixSubtree`/`frokFrom`：解决拓扑结构

所以，不需要维护场景树。仅仅使用`save()`/`restore()`就能实现与场景树一样灵活的操作