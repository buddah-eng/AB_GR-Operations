import{C as U,D as _,o as m,c as x,M as C,I as v,R as oe,S as se,E as Q,T as $e,H as ee,U as Ve,K as E,V as Se,W as ne,J as te,L as J,q as A,N as H,j as z,a as r,X as Be,G as F,Q as q,p,n as re,Y as Ae,Z as De,s as P,$ as j,a0 as Ne,a1 as Oe,a2 as Ee,a3 as Re,a4 as X,z as ae,i as l,a5 as Pe,F as ze,t as $,a6 as ie,d as le,k as ce,a7 as de,h as d,a8 as Ke,e as Y,g as je,l as Ie,b as S,v as I}from"./index-6Tulwnwh.js";import{s as Fe,a as N}from"./index-X1rZZqCz.js";import{b as He,s as ue,a as R,c as Ue}from"./index-CYe6ClAw.js";import{s as G}from"./index-DaA1BLPV.js";import{b as O,c as _e}from"./index-W75qzHs8.js";import{s as We}from"./index-D6LOd6qB.js";import{O as Me,C as qe}from"./index-PcH7va7w.js";import"./index-Cq2QSo8I.js";import"./index-BWcpVvVB.js";var Ye=`
    .p-tabs {
        display: flex;
        flex-direction: column;
    }

    .p-tablist {
        display: flex;
        position: relative;
        overflow: hidden;
        background: dt('tabs.tablist.background');
    }

    .p-tablist-viewport {
        overflow-x: auto;
        overflow-y: hidden;
        scroll-behavior: smooth;
        scrollbar-width: none;
        overscroll-behavior: contain auto;
    }

    .p-tablist-viewport::-webkit-scrollbar {
        display: none;
    }

    .p-tablist-tab-list {
        position: relative;
        display: flex;
        border-style: solid;
        border-color: dt('tabs.tablist.border.color');
        border-width: dt('tabs.tablist.border.width');
    }

    .p-tablist-content {
        flex-grow: 1;
    }

    .p-tablist-nav-button {
        all: unset;
        position: absolute !important;
        flex-shrink: 0;
        inset-block-start: 0;
        z-index: 2;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: dt('tabs.nav.button.background');
        color: dt('tabs.nav.button.color');
        width: dt('tabs.nav.button.width');
        transition:
            color dt('tabs.transition.duration'),
            outline-color dt('tabs.transition.duration'),
            box-shadow dt('tabs.transition.duration');
        box-shadow: dt('tabs.nav.button.shadow');
        outline-color: transparent;
        cursor: pointer;
    }

    .p-tablist-nav-button:focus-visible {
        z-index: 1;
        box-shadow: dt('tabs.nav.button.focus.ring.shadow');
        outline: dt('tabs.nav.button.focus.ring.width') dt('tabs.nav.button.focus.ring.style') dt('tabs.nav.button.focus.ring.color');
        outline-offset: dt('tabs.nav.button.focus.ring.offset');
    }

    .p-tablist-nav-button:hover {
        color: dt('tabs.nav.button.hover.color');
    }

    .p-tablist-prev-button {
        inset-inline-start: 0;
    }

    .p-tablist-next-button {
        inset-inline-end: 0;
    }

    .p-tablist-prev-button:dir(rtl),
    .p-tablist-next-button:dir(rtl) {
        transform: rotate(180deg);
    }

    .p-tab {
        flex-shrink: 0;
        cursor: pointer;
        user-select: none;
        position: relative;
        border-style: solid;
        white-space: nowrap;
        gap: dt('tabs.tab.gap');
        background: dt('tabs.tab.background');
        border-width: dt('tabs.tab.border.width');
        border-color: dt('tabs.tab.border.color');
        color: dt('tabs.tab.color');
        padding: dt('tabs.tab.padding');
        font-weight: dt('tabs.tab.font.weight');
        transition:
            background dt('tabs.transition.duration'),
            border-color dt('tabs.transition.duration'),
            color dt('tabs.transition.duration'),
            outline-color dt('tabs.transition.duration'),
            box-shadow dt('tabs.transition.duration');
        margin: dt('tabs.tab.margin');
        outline-color: transparent;
    }

    .p-tab:not(.p-disabled):focus-visible {
        z-index: 1;
        box-shadow: dt('tabs.tab.focus.ring.shadow');
        outline: dt('tabs.tab.focus.ring.width') dt('tabs.tab.focus.ring.style') dt('tabs.tab.focus.ring.color');
        outline-offset: dt('tabs.tab.focus.ring.offset');
    }

    .p-tab:not(.p-tab-active):not(.p-disabled):hover {
        background: dt('tabs.tab.hover.background');
        border-color: dt('tabs.tab.hover.border.color');
        color: dt('tabs.tab.hover.color');
    }

    .p-tab-active {
        background: dt('tabs.tab.active.background');
        border-color: dt('tabs.tab.active.border.color');
        color: dt('tabs.tab.active.color');
    }

    .p-tabpanels {
        background: dt('tabs.tabpanel.background');
        color: dt('tabs.tabpanel.color');
        padding: dt('tabs.tabpanel.padding');
        outline: 0 none;
    }

    .p-tabpanel:focus-visible {
        box-shadow: dt('tabs.tabpanel.focus.ring.shadow');
        outline: dt('tabs.tabpanel.focus.ring.width') dt('tabs.tabpanel.focus.ring.style') dt('tabs.tabpanel.focus.ring.color');
        outline-offset: dt('tabs.tabpanel.focus.ring.offset');
    }

    .p-tablist-active-bar {
        z-index: 1;
        display: block;
        position: absolute;
        inset-block-end: dt('tabs.active.bar.bottom');
        height: dt('tabs.active.bar.height');
        background: dt('tabs.active.bar.background');
        transition: 250ms cubic-bezier(0.35, 0, 0.25, 1);
    }
`,Ge={root:function(e){var i=e.props;return["p-tabs p-component",{"p-tabs-scrollable":i.scrollable}]}},Je=U.extend({name:"tabs",style:Ye,classes:Ge}),Qe={name:"BaseTabs",extends:_,props:{value:{type:[String,Number],default:void 0},lazy:{type:Boolean,default:!1},scrollable:{type:Boolean,default:!1},showNavigators:{type:Boolean,default:!0},tabindex:{type:Number,default:0},selectOnFocus:{type:Boolean,default:!1}},style:Je,provide:function(){return{$pcTabs:this,$parentInstance:this}}},pe={name:"Tabs",extends:Qe,inheritAttrs:!1,emits:["update:value"],data:function(){return{d_value:this.value}},watch:{value:function(e){this.d_value=e}},methods:{updateValue:function(e){this.d_value!==e&&(this.d_value=e,this.$emit("update:value",e))},isVertical:function(){return this.orientation==="vertical"}}};function Xe(t,e,i,a,u,o){return m(),x("div",v({class:t.cx("root")},t.ptmi("root")),[C(t.$slots,"default")],16)}pe.render=Xe;var Ze={root:"p-tablist",content:"p-tablist-content p-tablist-viewport",tabList:"p-tablist-tab-list",activeBar:"p-tablist-active-bar",prevButton:"p-tablist-prev-button p-tablist-nav-button",nextButton:"p-tablist-next-button p-tablist-nav-button"},et=U.extend({name:"tablist",classes:Ze}),tt={name:"BaseTabList",extends:_,props:{},style:et,provide:function(){return{$pcTabList:this,$parentInstance:this}}},fe={name:"TabList",extends:tt,inheritAttrs:!1,inject:["$pcTabs"],data:function(){return{isPrevButtonEnabled:!1,isNextButtonEnabled:!0}},resizeObserver:void 0,watch:{showNavigators:function(e){e?this.bindResizeObserver():this.unbindResizeObserver()},activeValue:{flush:"post",handler:function(){this.updateInkBar()}}},mounted:function(){var e=this;setTimeout(function(){e.updateInkBar()},150),this.showNavigators&&(this.updateButtonState(),this.bindResizeObserver())},updated:function(){this.showNavigators&&this.updateButtonState()},beforeUnmount:function(){this.unbindResizeObserver()},methods:{onScroll:function(e){this.showNavigators&&this.updateButtonState(),e.preventDefault()},onPrevButtonClick:function(){var e=this.$refs.content,i=this.getVisibleButtonWidths(),a=Q(e)-i,u=Math.abs(e.scrollLeft),o=a*.8,f=u-o,L=Math.max(f,0);e.scrollLeft=ne(e)?-1*L:L},onNextButtonClick:function(){var e=this.$refs.content,i=this.getVisibleButtonWidths(),a=Q(e)-i,u=Math.abs(e.scrollLeft),o=a*.8,f=u+o,L=e.scrollWidth-a,k=Math.min(f,L);e.scrollLeft=ne(e)?-1*k:k},bindResizeObserver:function(){var e=this;this.resizeObserver=new ResizeObserver(function(){return e.updateButtonState()}),this.resizeObserver.observe(this.$refs.list)},unbindResizeObserver:function(){var e;(e=this.resizeObserver)===null||e===void 0||e.unobserve(this.$refs.list),this.resizeObserver=void 0},updateInkBar:function(){var e=this.$refs,i=e.content,a=e.inkbar,u=e.tabs;if(a){var o=ee(i,'[data-pc-name="tab"][data-p-active="true"]');this.$pcTabs.isVertical()?(a.style.height=Ve(o)+"px",a.style.top=E(o).top-E(u).top+"px"):(a.style.width=Se(o)+"px",a.style.left=E(o).left-E(u).left+"px")}},updateButtonState:function(){var e=this.$refs,i=e.list,a=e.content,u=a.scrollTop,o=a.scrollWidth,f=a.scrollHeight,L=a.offsetWidth,k=a.offsetHeight,g=Math.abs(a.scrollLeft),h=[Q(a),$e(a)],y=h[0],w=h[1];this.$pcTabs.isVertical()?(this.isPrevButtonEnabled=u!==0,this.isNextButtonEnabled=i.offsetHeight>=k&&parseInt(u)!==f-w):(this.isPrevButtonEnabled=g!==0,this.isNextButtonEnabled=i.offsetWidth>=L&&parseInt(g)!==o-y)},getVisibleButtonWidths:function(){var e=this.$refs,i=e.prevButton,a=e.nextButton,u=0;return this.showNavigators&&(u=((i==null?void 0:i.offsetWidth)||0)+((a==null?void 0:a.offsetWidth)||0)),u}},computed:{templates:function(){return this.$pcTabs.$slots},activeValue:function(){return this.$pcTabs.d_value},showNavigators:function(){return this.$pcTabs.showNavigators},prevButtonAriaLabel:function(){return this.$primevue.config.locale.aria?this.$primevue.config.locale.aria.previous:void 0},nextButtonAriaLabel:function(){return this.$primevue.config.locale.aria?this.$primevue.config.locale.aria.next:void 0},dataP:function(){return se({scrollable:this.$pcTabs.scrollable})}},components:{ChevronLeftIcon:Fe,ChevronRightIcon:He},directives:{ripple:oe}},nt=["data-p"],at=["aria-label","tabindex"],it=["data-p"],ot=["aria-orientation"],st=["aria-label","tabindex"];function rt(t,e,i,a,u,o){var f=te("ripple");return m(),x("div",v({ref:"list",class:t.cx("root"),"data-p":o.dataP},t.ptmi("root")),[o.showNavigators&&u.isPrevButtonEnabled?J((m(),x("button",v({key:0,ref:"prevButton",type:"button",class:t.cx("prevButton"),"aria-label":o.prevButtonAriaLabel,tabindex:o.$pcTabs.tabindex,onClick:e[0]||(e[0]=function(){return o.onPrevButtonClick&&o.onPrevButtonClick.apply(o,arguments)})},t.ptm("prevButton"),{"data-pc-group-section":"navigator"}),[(m(),A(H(o.templates.previcon||"ChevronLeftIcon"),v({"aria-hidden":"true"},t.ptm("prevIcon")),null,16))],16,at)),[[f]]):z("",!0),r("div",v({ref:"content",class:t.cx("content"),onScroll:e[1]||(e[1]=function(){return o.onScroll&&o.onScroll.apply(o,arguments)}),"data-p":o.dataP},t.ptm("content")),[r("div",v({ref:"tabs",class:t.cx("tabList"),role:"tablist","aria-orientation":o.$pcTabs.orientation||"horizontal"},t.ptm("tabList")),[C(t.$slots,"default"),r("span",v({ref:"inkbar",class:t.cx("activeBar"),role:"presentation","aria-hidden":"true"},t.ptm("activeBar")),null,16)],16,ot)],16,it),o.showNavigators&&u.isNextButtonEnabled?J((m(),x("button",v({key:1,ref:"nextButton",type:"button",class:t.cx("nextButton"),"aria-label":o.nextButtonAriaLabel,tabindex:o.$pcTabs.tabindex,onClick:e[2]||(e[2]=function(){return o.onNextButtonClick&&o.onNextButtonClick.apply(o,arguments)})},t.ptm("nextButton"),{"data-pc-group-section":"navigator"}),[(m(),A(H(o.templates.nexticon||"ChevronRightIcon"),v({"aria-hidden":"true"},t.ptm("nextIcon")),null,16))],16,st)),[[f]]):z("",!0)],16,nt)}fe.render=rt;var lt={root:function(e){var i=e.instance,a=e.props;return["p-tab",{"p-tab-active":i.active,"p-disabled":a.disabled}]}},ct=U.extend({name:"tab",classes:lt}),dt={name:"BaseTab",extends:_,props:{value:{type:[String,Number],default:void 0},disabled:{type:Boolean,default:!1},as:{type:[String,Object],default:"BUTTON"},asChild:{type:Boolean,default:!1}},style:ct,provide:function(){return{$pcTab:this,$parentInstance:this}}},B={name:"Tab",extends:dt,inheritAttrs:!1,inject:["$pcTabs","$pcTabList"],methods:{onFocus:function(){this.$pcTabs.selectOnFocus&&this.changeActiveValue()},onClick:function(){this.changeActiveValue()},onKeydown:function(e){switch(e.code){case"ArrowRight":this.onArrowRightKey(e);break;case"ArrowLeft":this.onArrowLeftKey(e);break;case"Home":this.onHomeKey(e);break;case"End":this.onEndKey(e);break;case"PageDown":this.onPageDownKey(e);break;case"PageUp":this.onPageUpKey(e);break;case"Enter":case"NumpadEnter":case"Space":this.onEnterKey(e);break}},onArrowRightKey:function(e){var i=this.findNextTab(e.currentTarget);i?this.changeFocusedTab(e,i):this.onHomeKey(e),e.preventDefault()},onArrowLeftKey:function(e){var i=this.findPrevTab(e.currentTarget);i?this.changeFocusedTab(e,i):this.onEndKey(e),e.preventDefault()},onHomeKey:function(e){var i=this.findFirstTab();this.changeFocusedTab(e,i),e.preventDefault()},onEndKey:function(e){var i=this.findLastTab();this.changeFocusedTab(e,i),e.preventDefault()},onPageDownKey:function(e){this.scrollInView(this.findLastTab()),e.preventDefault()},onPageUpKey:function(e){this.scrollInView(this.findFirstTab()),e.preventDefault()},onEnterKey:function(e){this.changeActiveValue()},findNextTab:function(e){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:!1,a=i?e:e.nextElementSibling;return a?q(a,"data-p-disabled")||q(a,"data-pc-section")==="activebar"?this.findNextTab(a):ee(a,'[data-pc-name="tab"]'):null},findPrevTab:function(e){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:!1,a=i?e:e.previousElementSibling;return a?q(a,"data-p-disabled")||q(a,"data-pc-section")==="activebar"?this.findPrevTab(a):ee(a,'[data-pc-name="tab"]'):null},findFirstTab:function(){return this.findNextTab(this.$pcTabList.$refs.tabs.firstElementChild,!0)},findLastTab:function(){return this.findPrevTab(this.$pcTabList.$refs.tabs.lastElementChild,!0)},changeActiveValue:function(){this.$pcTabs.updateValue(this.value)},changeFocusedTab:function(e,i){F(i),this.scrollInView(i)},scrollInView:function(e){var i;e==null||(i=e.scrollIntoView)===null||i===void 0||i.call(e,{block:"nearest"})}},computed:{active:function(){var e;return Be((e=this.$pcTabs)===null||e===void 0?void 0:e.d_value,this.value)},id:function(){var e;return"".concat((e=this.$pcTabs)===null||e===void 0?void 0:e.$id,"_tab_").concat(this.value)},ariaControls:function(){var e;return"".concat((e=this.$pcTabs)===null||e===void 0?void 0:e.$id,"_tabpanel_").concat(this.value)},attrs:function(){return v(this.asAttrs,this.a11yAttrs,this.ptmi("root",this.ptParams))},asAttrs:function(){return this.as==="BUTTON"?{type:"button",disabled:this.disabled}:void 0},a11yAttrs:function(){return{id:this.id,tabindex:this.active?this.$pcTabs.tabindex:-1,role:"tab","aria-selected":this.active,"aria-controls":this.ariaControls,"data-pc-name":"tab","data-p-disabled":this.disabled,"data-p-active":this.active,onFocus:this.onFocus,onKeydown:this.onKeydown}},ptParams:function(){return{context:{active:this.active}}},dataP:function(){return se({active:this.active})}},directives:{ripple:oe}};function ut(t,e,i,a,u,o){var f=te("ripple");return t.asChild?C(t.$slots,"default",{key:1,dataP:o.dataP,class:re(t.cx("root")),active:o.active,a11yAttrs:o.a11yAttrs,onClick:o.onClick}):J((m(),A(H(t.as),v({key:0,class:t.cx("root"),"data-p":o.dataP,onClick:o.onClick},o.attrs),{default:p(function(){return[C(t.$slots,"default")]}),_:3},16,["class","data-p","onClick"])),[[f]])}B.render=ut;var pt={root:"p-tabpanels"},ft=U.extend({name:"tabpanels",classes:pt}),bt={name:"BaseTabPanels",extends:_,props:{},style:ft,provide:function(){return{$pcTabPanels:this,$parentInstance:this}}},be={name:"TabPanels",extends:bt,inheritAttrs:!1};function vt(t,e,i,a,u,o){return m(),x("div",v({class:t.cx("root"),role:"presentation"},t.ptmi("root")),[C(t.$slots,"default")],16)}be.render=vt;var mt=`
    .p-confirmpopup {
        position: absolute;
        margin-top: dt('confirmpopup.gutter');
        top: 0;
        left: 0;
        background: dt('confirmpopup.background');
        color: dt('confirmpopup.color');
        border: 1px solid dt('confirmpopup.border.color');
        border-radius: dt('confirmpopup.border.radius');
        box-shadow: dt('confirmpopup.shadow');
        will-change: transform;
    }

    .p-confirmpopup-content {
        display: flex;
        align-items: center;
        padding: dt('confirmpopup.content.padding');
        gap: dt('confirmpopup.content.gap');
    }

    .p-confirmpopup-icon {
        font-size: dt('confirmpopup.icon.size');
        width: dt('confirmpopup.icon.size');
        height: dt('confirmpopup.icon.size');
        color: dt('confirmpopup.icon.color');
    }

    .p-confirmpopup-footer {
        display: flex;
        justify-content: flex-end;
        gap: dt('confirmpopup.footer.gap');
        padding: dt('confirmpopup.footer.padding');
    }

    .p-confirmpopup-footer button {
        width: auto;
    }

    .p-confirmpopup-footer button:last-child {
        margin: 0;
    }

    .p-confirmpopup-flipped {
        margin-block-start: calc(dt('confirmpopup.gutter') * -1);
        margin-block-end: dt('confirmpopup.gutter');
    }

    .p-confirmpopup:after,
    .p-confirmpopup:before {
        bottom: 100%;
        left: calc(dt('confirmpopup.arrow.offset') + dt('confirmpopup.arrow.left'));
        content: ' ';
        height: 0;
        width: 0;
        position: absolute;
        pointer-events: none;
    }

    .p-confirmpopup:after {
        border-width: calc(dt('confirmpopup.gutter') - 2px);
        margin-left: calc(-1 * (dt('confirmpopup.gutter') - 2px));
        border-style: solid;
        border-color: transparent;
        border-bottom-color: dt('confirmpopup.background');
    }

    .p-confirmpopup:before {
        border-width: dt('confirmpopup.gutter');
        margin-left: calc(-1 * dt('confirmpopup.gutter'));
        border-style: solid;
        border-color: transparent;
        border-bottom-color: dt('confirmpopup.border.color');
    }

    .p-confirmpopup-flipped:after,
    .p-confirmpopup-flipped:before {
        bottom: auto;
        top: 100%;
    }

    .p-confirmpopup-flipped:after {
        border-bottom-color: transparent;
        border-top-color: dt('confirmpopup.background');
    }

    .p-confirmpopup-flipped:before {
        border-bottom-color: transparent;
        border-top-color: dt('confirmpopup.border.color');
    }
`,ht={root:"p-confirmpopup p-component",content:"p-confirmpopup-content",icon:"p-confirmpopup-icon",message:"p-confirmpopup-message",footer:"p-confirmpopup-footer",pcRejectButton:"p-confirmpopup-reject-button",pcAcceptButton:"p-confirmpopup-accept-button"},gt=U.extend({name:"confirmpopup",style:mt,classes:ht}),yt={name:"BaseConfirmPopup",extends:_,props:{group:String},style:gt,provide:function(){return{$pcConfirmPopup:this,$parentInstance:this}}},ve={name:"ConfirmPopup",extends:yt,inheritAttrs:!1,data:function(){return{visible:!1,confirmation:null,autoFocusAccept:null,autoFocusReject:null,target:null}},target:null,outsideClickListener:null,scrollHandler:null,resizeListener:null,container:null,confirmListener:null,closeListener:null,mounted:function(){var e=this;this.confirmListener=function(i){i&&i.group===e.group&&(e.confirmation=i,e.target=i.target,e.confirmation.onShow&&e.confirmation.onShow(),e.visible=!0)},this.closeListener=function(){e.visible=!1,e.confirmation=null},j.on("confirm",this.confirmListener),j.on("close",this.closeListener)},beforeUnmount:function(){j.off("confirm",this.confirmListener),j.off("close",this.closeListener),this.unbindOutsideClickListener(),this.scrollHandler&&(this.scrollHandler.destroy(),this.scrollHandler=null),this.unbindResizeListener(),this.container&&(X.clear(this.container),this.container=null),this.target=null,this.confirmation=null},methods:{accept:function(){this.confirmation.accept&&this.confirmation.accept(),this.visible=!1},reject:function(){this.confirmation.reject&&this.confirmation.reject(),this.visible=!1},onHide:function(){this.confirmation.onHide&&this.confirmation.onHide(),this.visible=!1},onAcceptKeydown:function(e){(e.code==="Space"||e.code==="Enter"||e.code==="NumpadEnter")&&(this.accept(),F(this.target),e.preventDefault())},onRejectKeydown:function(e){(e.code==="Space"||e.code==="Enter"||e.code==="NumpadEnter")&&(this.reject(),F(this.target),e.preventDefault())},onEnter:function(e){this.autoFocusAccept=this.confirmation.defaultFocus===void 0||this.confirmation.defaultFocus==="accept",this.autoFocusReject=this.confirmation.defaultFocus==="reject",this.target=this.target||document.activeElement,this.bindOutsideClickListener(),this.bindScrollListener(),this.bindResizeListener(),X.set("overlay",e,this.$primevue.config.zIndex.overlay)},onAfterEnter:function(){this.focus()},onLeave:function(){this.autoFocusAccept=null,this.autoFocusReject=null,F(this.target),this.target=null,this.unbindOutsideClickListener(),this.unbindScrollListener(),this.unbindResizeListener()},onAfterLeave:function(e){X.clear(e)},alignOverlay:function(){Oe(this.container,this.target,!1);var e=E(this.container),i=E(this.target),a=0;e.left<i.left&&(a=i.left-e.left),this.container.style.setProperty(Ee("confirmpopup.arrow.left").name,"".concat(a,"px")),e.top<i.top&&(this.container.setAttribute("data-p-confirmpopup-flipped","true"),!this.isUnstyled&&Re(this.container,"p-confirmpopup-flipped"))},bindOutsideClickListener:function(){var e=this;this.outsideClickListener||(this.outsideClickListener=function(i){e.visible&&e.container&&!e.container.contains(i.target)&&!e.isTargetClicked(i)?(e.confirmation.onHide&&e.confirmation.onHide(),e.visible=!1):e.alignOverlay()},document.addEventListener("click",this.outsideClickListener))},unbindOutsideClickListener:function(){this.outsideClickListener&&(document.removeEventListener("click",this.outsideClickListener),this.outsideClickListener=null)},bindScrollListener:function(){var e=this;this.scrollHandler||(this.scrollHandler=new qe(this.target,function(){e.visible&&(e.visible=!1)})),this.scrollHandler.bindScrollListener()},unbindScrollListener:function(){this.scrollHandler&&this.scrollHandler.unbindScrollListener()},bindResizeListener:function(){var e=this;this.resizeListener||(this.resizeListener=function(){e.visible&&!Ne()&&(e.visible=!1)},window.addEventListener("resize",this.resizeListener))},unbindResizeListener:function(){this.resizeListener&&(window.removeEventListener("resize",this.resizeListener),this.resizeListener=null)},focus:function(){var e=this.container.querySelector("[autofocus]");e&&e.focus({preventScroll:!0})},isTargetClicked:function(e){return this.target&&(this.target===e.target||this.target.contains(e.target))},containerRef:function(e){this.container=e},onOverlayClick:function(e){Me.emit("overlay-click",{originalEvent:e,target:this.target})},onOverlayKeydown:function(e){e.code==="Escape"&&(j.emit("close",this.closeListener),F(this.target))}},computed:{message:function(){return this.confirmation?this.confirmation.message:null},acceptLabel:function(){if(this.confirmation){var e,i=this.confirmation;return i.acceptLabel||((e=i.acceptProps)===null||e===void 0?void 0:e.label)||this.$primevue.config.locale.accept}return this.$primevue.config.locale.accept},rejectLabel:function(){if(this.confirmation){var e,i=this.confirmation;return i.rejectLabel||((e=i.rejectProps)===null||e===void 0?void 0:e.label)||this.$primevue.config.locale.reject}return this.$primevue.config.locale.reject},acceptIcon:function(){var e;return this.confirmation?this.confirmation.acceptIcon:(e=this.confirmation)!==null&&e!==void 0&&e.acceptProps?this.confirmation.acceptProps.icon:null},rejectIcon:function(){var e;return this.confirmation?this.confirmation.rejectIcon:(e=this.confirmation)!==null&&e!==void 0&&e.rejectProps?this.confirmation.rejectProps.icon:null}},components:{Button:P,Portal:De},directives:{focustrap:Ae}},wt=["aria-modal"];function xt(t,e,i,a,u,o){var f=ae("Button"),L=ae("Portal"),k=te("focustrap");return m(),A(L,null,{default:p(function(){return[l(Pe,v({name:"p-anchored-overlay",onEnter:o.onEnter,onAfterEnter:o.onAfterEnter,onLeave:o.onLeave,onAfterLeave:o.onAfterLeave},t.ptm("transition")),{default:p(function(){var g,h,y;return[u.visible?J((m(),x("div",v({key:0,ref:o.containerRef,role:"alertdialog",class:t.cx("root"),"aria-modal":u.visible,onClick:e[2]||(e[2]=function(){return o.onOverlayClick&&o.onOverlayClick.apply(o,arguments)}),onKeydown:e[3]||(e[3]=function(){return o.onOverlayKeydown&&o.onOverlayKeydown.apply(o,arguments)})},t.ptmi("root")),[t.$slots.container?C(t.$slots,"container",{key:0,message:u.confirmation,acceptCallback:o.accept,rejectCallback:o.reject}):(m(),x(ze,{key:1},[t.$slots.message?(m(),A(H(t.$slots.message),{key:1,message:u.confirmation},null,8,["message"])):(m(),x("div",v({key:0,class:t.cx("content")},t.ptm("content")),[C(t.$slots,"icon",{},function(){return[t.$slots.icon?(m(),A(H(t.$slots.icon),{key:0,class:re(t.cx("icon"))},null,8,["class"])):u.confirmation.icon?(m(),x("span",v({key:1,class:[u.confirmation.icon,t.cx("icon")]},t.ptm("icon")),null,16)):z("",!0)]}),r("span",v({class:t.cx("message")},t.ptm("message")),$(u.confirmation.message),17)],16)),r("div",v({class:t.cx("footer")},t.ptm("footer")),[l(f,v({class:[t.cx("pcRejectButton"),u.confirmation.rejectClass],autofocus:u.autoFocusReject,unstyled:t.unstyled,size:((g=u.confirmation.rejectProps)===null||g===void 0?void 0:g.size)||"small",text:((h=u.confirmation.rejectProps)===null||h===void 0?void 0:h.text)||!1,onClick:e[0]||(e[0]=function(w){return o.reject()}),onKeydown:o.onRejectKeydown},u.confirmation.rejectProps,{label:o.rejectLabel,pt:t.ptm("pcRejectButton")}),ie({_:2},[o.rejectIcon||t.$slots.rejecticon?{name:"icon",fn:p(function(w){return[C(t.$slots,"rejecticon",{},function(){return[r("span",v({class:[o.rejectIcon,w.class]},t.ptm("pcRejectButton").icon,{"data-pc-section":"rejectbuttonicon"}),null,16)]})]}),key:"0"}:void 0]),1040,["class","autofocus","unstyled","size","text","onKeydown","label","pt"]),l(f,v({class:[t.cx("pcAcceptButton"),u.confirmation.acceptClass],autofocus:u.autoFocusAccept,unstyled:t.unstyled,size:((y=u.confirmation.acceptProps)===null||y===void 0?void 0:y.size)||"small",onClick:e[1]||(e[1]=function(w){return o.accept()}),onKeydown:o.onAcceptKeydown},u.confirmation.acceptProps,{label:o.acceptLabel,pt:t.ptm("pcAcceptButton")}),ie({_:2},[o.acceptIcon||t.$slots.accepticon?{name:"icon",fn:p(function(w){return[C(t.$slots,"accepticon",{},function(){return[r("span",v({class:[o.acceptIcon,w.class]},t.ptm("pcAcceptButton").icon,{"data-pc-section":"acceptbuttonicon"}),null,16)]})]}),key:"0"}:void 0]),1040,["class","autofocus","unstyled","size","onKeydown","label","pt"])],16)],64))],16,wt)),[[k]]):z("",!0)]}),_:3},16,["onEnter","onAfterEnter","onLeave","onAfterLeave"])]}),_:3})}ve.render=xt;const Lt={class:"space-y-5 pt-4"},kt={class:"font-display"},Ct={class:"flex items-end gap-3"},Tt={class:"flex flex-col gap-2 flex-1 max-w-sm"},$t={class:"text-sm font-medium text-surface-700"},Vt={class:"text-center py-8 text-surface-400"},Z=le({__name:"SettingsListEditor",props:{items:{},fieldKey:{},fieldHeader:{},itemLabel:{},placeholder:{}},emits:["add","delete"],setup(t,{emit:e}){const i=t,a=e,u=ce(),o=de(),f=Y("");function L(){const g=f.value.trim();if(!g){u.add({severity:"warn",summary:"Validation",detail:`${i.itemLabel} name is required`,life:3e3});return}if(i.items.some(y=>String(y[i.fieldKey]).toLowerCase()===g.toLowerCase())){u.add({severity:"warn",summary:"Duplicate",detail:`This ${i.itemLabel.toLowerCase()} already exists`,life:3e3});return}a("add",g),f.value=""}function k(g,h){var w;const y=String(((w=i.items[h])==null?void 0:w[i.fieldKey])??"");o.require({target:g.currentTarget,message:`Delete ${i.itemLabel.toLowerCase()} "${y}"?`,icon:"pi pi-exclamation-triangle",acceptClass:"p-button-danger",accept:()=>a("delete",h)})}return(g,h)=>(m(),x("div",Lt,[l(d(G),null,{title:p(()=>[r("span",kt,"Add "+$(t.itemLabel),1)]),content:p(()=>[r("div",Ct,[r("div",Tt,[r("label",$t,$(t.fieldHeader),1),l(d(O),{modelValue:f.value,"onUpdate:modelValue":h[0]||(h[0]=y=>f.value=y),placeholder:t.placeholder,onKeydown:Ke(L,["enter"])},null,8,["modelValue","placeholder"])]),l(d(P),{label:"Add",icon:"pi pi-plus",onClick:L})])]),_:1}),l(d(ue),{value:t.items,stripedRows:"",tableStyle:"min-width: 30rem"},{empty:p(()=>[r("div",Vt," No "+$(t.itemLabel.toLowerCase())+"s configured ",1)]),default:p(()=>[l(d(R),{field:t.fieldKey,header:t.fieldHeader,sortable:""},null,8,["field","header"]),l(d(R),{header:"Actions",style:{width:"8rem"},exportable:!1},{body:p(({index:y})=>[l(d(P),{icon:"pi pi-trash",severity:"danger",text:"",rounded:"","aria-label":`Delete ${t.itemLabel.toLowerCase()}`,onClick:w=>k(w,y)},null,8,["aria-label","onClick"])]),_:1})]),_:1},8,["value"])]))}}),St={class:"space-y-6"},Bt={class:"space-y-6 pt-4"},At={key:0,class:"rounded-lg border-l-4 border-accent-500 bg-accent-50 px-5 py-4"},Dt={class:"flex items-center gap-3"},Nt={class:"font-display text-lg font-bold text-accent-800"},Ot={class:"text-sm text-accent-700 ml-1.5"},Et={class:"grid grid-cols-1 md:grid-cols-2 gap-5"},Rt={class:"flex flex-col gap-2"},Pt={class:"flex flex-col gap-2"},zt={class:"flex flex-col gap-2"},Kt={class:"flex flex-col gap-2"},jt={class:"mt-5"},It={class:"space-y-5 pt-4"},Ft={class:"grid grid-cols-1 md:grid-cols-3 gap-4"},Ht={class:"flex flex-col gap-2"},Ut={class:"flex flex-col gap-2"},_t={class:"flex flex-col gap-2"},Wt={class:"mt-4"},Mt={key:0},qt={key:1,class:"text-surface-400"},an=le({__name:"SettingsView",setup(t){const e=ce(),i=de(),a=je(),u=Y("convention");function o(s){u.value=String(s)}const f=Y({name:"",startDate:"",endDate:"",venue:""});function L(){var n;const s=((n=a.config)==null?void 0:n.convention)??{};f.value={name:String(s.name??""),startDate:String(s.startDate??""),endDate:String(s.endDate??""),venue:String(s.venue??"")}}const k=I(()=>{const s=f.value.startDate;if(!s)return null;const n=new Date(s+"T00:00:00");if(isNaN(n.getTime()))return null;const c=new Date;c.setHours(0,0,0,0);const b=Math.ceil((n.getTime()-c.getTime())/(1e3*60*60*24));return b>0?b:null});async function g(){const s=f.value;if(!s.name.trim()){e.add({severity:"warn",summary:"Validation",detail:"Convention name is required",life:3e3});return}a.config={...a.config,convention:{name:s.name.trim(),startDate:s.startDate,endDate:s.endDate,venue:s.venue.trim()}};const n=await a.saveConfig();e.add({severity:n?"success":"warn",summary:n?"Saved":"Local Only",detail:n?"Convention config saved":"Saved locally — backend unavailable",life:3e3})}const h=I(()=>{var s;return((s=a.config)==null?void 0:s.departments)??[]});async function y(s){a.config={...a.config,departments:[...h.value,{"Department Name":s}]};const n=await a.saveConfig();e.add({severity:n?"success":"warn",summary:n?"Added":"Added (Local Only)",detail:`Department "${s}" added`,life:3e3})}async function w(s){var b;const n=String(((b=h.value[s])==null?void 0:b["Department Name"])??"");a.config={...a.config,departments:h.value.filter((K,V)=>V!==s)};const c=await a.saveConfig();e.add({severity:c?"info":"warn",summary:c?"Deleted":"Deleted (Local Only)",detail:`Department "${n}" removed`,life:3e3})}const W=I(()=>{var s;return((s=a.config)==null?void 0:s.roles)??[]});async function me(s){a.config={...a.config,roles:[...W.value,{"Role Name":s}]};const n=await a.saveConfig();e.add({severity:n?"success":"warn",summary:n?"Added":"Added (Local Only)",detail:`Role "${s}" added`,life:3e3})}async function he(s){var b;const n=String(((b=W.value[s])==null?void 0:b["Role Name"])??"");a.config={...a.config,roles:W.value.filter((K,V)=>V!==s)};const c=await a.saveConfig();e.add({severity:c?"info":"warn",summary:c?"Deleted":"Deleted (Local Only)",detail:`Role "${n}" removed`,life:3e3})}const M=I(()=>{var s;return((s=a.config)==null?void 0:s.eventTypes)??[]});async function ge(s){a.config={...a.config,eventTypes:[...M.value,{"Type Name":s}]};const n=await a.saveConfig();e.add({severity:n?"success":"warn",summary:n?"Added":"Added (Local Only)",detail:`Event type "${s}" added`,life:3e3})}async function ye(s){var b;const n=String(((b=M.value[s])==null?void 0:b["Type Name"])??"");a.config={...a.config,eventTypes:M.value.filter((K,V)=>V!==s)};const c=await a.saveConfig();e.add({severity:c?"info":"warn",summary:c?"Deleted":"Deleted (Local Only)",detail:`Event type "${n}" removed`,life:3e3})}const we=["Hall","Room","Restaurant","Outdoor","Other"],T=Y({name:"",type:null,capacity:null}),D=I(()=>{var s;return((s=a.config)==null?void 0:s.venues)??[]});async function xe(){const s=T.value;if(!s.name.trim()){e.add({severity:"warn",summary:"Validation",detail:"Venue name is required",life:3e3});return}if(D.value.some(K=>String(K["Venue Name"]).toLowerCase()===s.name.trim().toLowerCase())){e.add({severity:"warn",summary:"Duplicate",detail:"This venue already exists",life:3e3});return}const c={"Venue Name":s.name.trim()};s.type&&(c["Venue Type"]=s.type),s.capacity!==null&&s.capacity>0&&(c.Capacity=s.capacity),a.config={...a.config,venues:[...D.value,c]},T.value={name:"",type:null,capacity:null};const b=await a.saveConfig();e.add({severity:b?"success":"warn",summary:b?"Added":"Added (Local Only)",detail:`Venue "${String(c["Venue Name"])}" added`,life:3e3})}function Le(s,n){var b;const c=String(((b=D.value[n])==null?void 0:b["Venue Name"])??"");i.require({target:s.currentTarget,message:`Delete venue "${c}"?`,icon:"pi pi-exclamation-triangle",acceptClass:"p-button-danger",accept:()=>ke(n)})}async function ke(s){var b;const n=String(((b=D.value[s])==null?void 0:b["Venue Name"])??"");a.config={...a.config,venues:D.value.filter((K,V)=>V!==s)};const c=await a.saveConfig();e.add({severity:c?"info":"warn",summary:c?"Deleted":"Deleted (Local Only)",detail:`Venue "${n}" removed`,life:3e3})}const Ce={Hall:"info",Room:"success",Restaurant:"warn",Outdoor:"secondary",Other:"secondary"};function Te(s){return Ce[s]??"secondary"}return Ie(()=>{L()}),(s,n)=>(m(),x("div",St,[n[25]||(n[25]=r("div",{class:"flex items-center justify-between"},[r("h1",{class:"font-display text-2xl font-bold tracking-tight text-surface-900"}," Settings ")],-1)),l(d(pe),{value:u.value,"onUpdate:value":o},{default:p(()=>[l(d(fe),null,{default:p(()=>[l(d(B),{value:"convention"},{default:p(()=>[...n[7]||(n[7]=[S("Convention",-1)])]),_:1}),l(d(B),{value:"departments"},{default:p(()=>[...n[8]||(n[8]=[S("Departments",-1)])]),_:1}),l(d(B),{value:"roles"},{default:p(()=>[...n[9]||(n[9]=[S("Roles",-1)])]),_:1}),l(d(B),{value:"event-types"},{default:p(()=>[...n[10]||(n[10]=[S("Event Types",-1)])]),_:1}),l(d(B),{value:"venues"},{default:p(()=>[...n[11]||(n[11]=[S("Venues",-1)])]),_:1}),l(d(B),{value:"users"},{default:p(()=>[...n[12]||(n[12]=[S("Users",-1)])]),_:1})]),_:1}),l(d(be),null,{default:p(()=>[l(d(N),{value:"convention"},{default:p(()=>[r("div",Bt,[k.value!==null?(m(),x("div",At,[r("div",Dt,[n[13]||(n[13]=r("i",{class:"pi pi-calendar text-accent-600 text-xl"},null,-1)),r("div",null,[r("span",Nt,$(k.value),1),r("span",Ot," day"+$(k.value===1?"":"s")+" until "+$(f.value.name||"convention"),1)])])])):z("",!0),l(d(G),null,{title:p(()=>[...n[14]||(n[14]=[r("span",{class:"font-display"},"Convention Details",-1)])]),content:p(()=>[r("div",Et,[r("div",Rt,[n[15]||(n[15]=r("label",{class:"text-sm font-medium text-surface-700"}," Convention Name ",-1)),l(d(O),{modelValue:f.value.name,"onUpdate:modelValue":n[0]||(n[0]=c=>f.value.name=c)},null,8,["modelValue"])]),r("div",Pt,[n[16]||(n[16]=r("label",{class:"text-sm font-medium text-surface-700"}," Venue ",-1)),l(d(O),{modelValue:f.value.venue,"onUpdate:modelValue":n[1]||(n[1]=c=>f.value.venue=c)},null,8,["modelValue"])]),r("div",zt,[n[17]||(n[17]=r("label",{class:"text-sm font-medium text-surface-700"}," Start Date ",-1)),l(d(O),{modelValue:f.value.startDate,"onUpdate:modelValue":n[2]||(n[2]=c=>f.value.startDate=c),type:"date"},null,8,["modelValue"])]),r("div",Kt,[n[18]||(n[18]=r("label",{class:"text-sm font-medium text-surface-700"}," End Date ",-1)),l(d(O),{modelValue:f.value.endDate,"onUpdate:modelValue":n[3]||(n[3]=c=>f.value.endDate=c),type:"date"},null,8,["modelValue"])])]),r("div",jt,[l(d(P),{label:"Save Convention Config",icon:"pi pi-save",onClick:g})])]),_:1})])]),_:1}),l(d(N),{value:"departments"},{default:p(()=>[l(Z,{items:h.value,"field-key":"Department Name","field-header":"Department Name","item-label":"Department",placeholder:"e.g. Marketing",onAdd:y,onDelete:w},null,8,["items"])]),_:1}),l(d(N),{value:"roles"},{default:p(()=>[l(Z,{items:W.value,"field-key":"Role Name","field-header":"Role Name","item-label":"Role",placeholder:"e.g. Green Room Attendant",onAdd:me,onDelete:he},null,8,["items"])]),_:1}),l(d(N),{value:"event-types"},{default:p(()=>[l(Z,{items:M.value,"field-key":"Type Name","field-header":"Type Name","item-label":"Event Type",placeholder:"e.g. Workshop",onAdd:ge,onDelete:ye},null,8,["items"])]),_:1}),l(d(N),{value:"venues"},{default:p(()=>[r("div",It,[l(d(G),null,{title:p(()=>[...n[19]||(n[19]=[r("span",{class:"font-display"},"Add Venue",-1)])]),content:p(()=>[r("div",Ft,[r("div",Ht,[n[20]||(n[20]=r("label",{class:"text-sm font-medium text-surface-700"}," Venue Name ",-1)),l(d(O),{modelValue:T.value.name,"onUpdate:modelValue":n[4]||(n[4]=c=>T.value.name=c),placeholder:"e.g. Main Stage"},null,8,["modelValue"])]),r("div",Ut,[n[21]||(n[21]=r("label",{class:"text-sm font-medium text-surface-700"}," Type ",-1)),l(d(_e),{modelValue:T.value.type,"onUpdate:modelValue":n[5]||(n[5]=c=>T.value.type=c),options:we,placeholder:"Select type"},null,8,["modelValue"])]),r("div",_t,[n[22]||(n[22]=r("label",{class:"text-sm font-medium text-surface-700"}," Capacity ",-1)),l(d(Ue),{modelValue:T.value.capacity,"onUpdate:modelValue":n[6]||(n[6]=c=>T.value.capacity=c),min:0,placeholder:"0"},null,8,["modelValue"])])]),r("div",Wt,[l(d(P),{label:"Add Venue",icon:"pi pi-plus",onClick:xe})])]),_:1}),l(d(ue),{value:D.value,stripedRows:"",tableStyle:"min-width: 40rem"},{empty:p(()=>[...n[23]||(n[23]=[r("div",{class:"text-center py-8 text-surface-400"}," No venues configured ",-1)])]),default:p(()=>[l(d(R),{field:"Venue Name",header:"Venue Name",sortable:""}),l(d(R),{field:"Venue Type",header:"Type",sortable:""},{body:p(({data:c})=>[c["Venue Type"]?(m(),A(d(We),{key:0,value:String(c["Venue Type"]),severity:Te(String(c["Venue Type"])),rounded:""},null,8,["value","severity"])):z("",!0)]),_:1}),l(d(R),{field:"Capacity",header:"Capacity",sortable:""},{body:p(({data:c})=>[c.Capacity?(m(),x("span",Mt,$(Number(c.Capacity).toLocaleString()),1)):(m(),x("span",qt,"—"))]),_:1}),l(d(R),{header:"Actions",style:{width:"8rem"},exportable:!1},{body:p(({index:c})=>[l(d(P),{icon:"pi pi-trash",severity:"danger",text:"",rounded:"","aria-label":"Delete venue",onClick:b=>Le(b,c)},null,8,["onClick"])]),_:1})]),_:1},8,["value"])])]),_:1}),l(d(N),{value:"users"},{default:p(()=>[l(d(G),{class:"mt-4"},{content:p(()=>[...n[24]||(n[24]=[r("div",{class:"text-center py-12"},[r("i",{class:"pi pi-users text-5xl text-surface-300 mb-4"}),r("h2",{class:"font-display text-lg font-semibold text-surface-700 mb-2"}," User Management "),r("p",{class:"text-sm text-surface-400 max-w-md mx-auto mb-6"}," User management requires Firebase Admin SDK integration. Users are managed via Firebase Console. "),r("a",{href:"https://console.firebase.google.com/project/_/authentication/users",target:"_blank",rel:"noopener noreferrer",class:"inline-flex items-center gap-2 text-sm font-medium text-accent-600 hover:text-accent-700 transition-colors"},[r("i",{class:"pi pi-external-link"}),S(" Open Firebase Console ")])],-1)])]),_:1})]),_:1})]),_:1})]),_:1},8,["value"]),l(d(ve))]))}});export{an as default};
