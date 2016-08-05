(function() {
    /* Models */
    var Profile = Backbone.Model.extend({
        url: function() {
            return "/web/user" + '?phoneNumber=' + encodeURIComponent("+") + $.cookie("msisdn")
        },
        initialize: function() {
            this.on("change:username", this.sync_username)
        },
        set_username: function(name) {
            this.set("username", name)
        },
        sync_username: function() {
            $.ajax({
                url: Backbone.server_url + decodeURI(this.url()),
                type: "PUT",
                data: {"username": this.get("username")},
                dataType: "json",
                success: function(user){
                  $.cookie("userId", user.id)
                }
            })
        }
    })

    var Meeting = Backbone.Model.extend({
        STATES: {
          /*
            0 = open, but guest has not yet answered
            1 = open, guest has answered
            2 = cancelled by host
            3 = cancelled by guest
            4 = created by host but no invitation has been sent (concerns webMeetings)
          */
          "OPEN_UNANSWERED":    0,
          "OPEN_ANSWERED":      1,
          "CANCELED_BY_HOST":   2,
          "CANCELED_BY_GUEST":  3,
          "NO_INVITATION_SENT": 4
        },
        urlRoot: "/web/meeting/",
        url: function(){
            return this.urlRoot + encodeURIComponent(this.id) + '?msisdn=' + $.cookie("msisdn") + '&countryCode=' + $.cookie("country-code")
        },
        initialize: function() {
            this.alert = false
            this.fetch()
            this._setup()
            this.getGuestLocation()
            this.on("confirm", this.confirm)
            this.on("cancel", this.cancel)
            this.on("change:status", this.sync_status)
        },

        confirm: function() {
            this.set("status", this.STATES.OPEN_ANSWERED)
        },

        cancel: function() {
            this.set("status", this.STATES.CANCELED_BY_GUEST)
        },

        sync_status: function() {
          if(this.get("status")){
            $.ajax({
                url: Backbone.server_url + decodeURI(this.url()),
                type: "PUT",
                data: {"status": this.get("status")},
                dataType: "json"
            })
          }
        },

        _setup: function() {
            this.getGuestLocation()

            // set default travel mode
            var maproute = _.first(_.values(google.maps.DirectionsTravelMode))
            this.set("maproute", maproute.toLowerCase())
        },

        getGuestLocation: function() {
            var callback = _.bind(function(position) {
                this.set("guest.coords", position.coords)
            }, this)
            var error = _.bind(function(error) {
                if(error.code==1){
                  console.log("Get location error: Code " + error.code + " Message " + error.message)
                  if(!this.alert){
                    alert("It looks like you have not granted access to your location so treffn will not work. Please check your settings and reload the page.")
                    this.alert = true
                  }
                }
                if(error.code==2){
                  console.log("Get location error: Code " + error.code + " Message " + error.message)
                  if(!this.alert){
                    alert("It looks like your location/GPS is off. Please check your settings and reload the page")
                    this.alert = true
                  }
                }
                if(error.code==3){
                  // timeout
                  navigator.geolocation.getCurrentPosition(callback, error, {enableHighAccuracy : false})
                }
            }, this)
            navigator.geolocation.getCurrentPosition(callback, error, {enableHighAccuracy : true, timeout: 30000})
        }
    })

    var ChatMessage = Backbone.Model.extend({
        idAttribute: "createdAt",
        urlRoot: _.template("/web/meeting/<%- id %>/message"),
        url: function() {
            return this.urlRoot({id: encodeURIComponent(this.collection.meeting.id)}) + '?msisdn=' + $.cookie("msisdn")
        },

        initialize: function() {
            //this.set("text", this._processSyntax(this.get("text")))
        },

        set: function(attributes, options) {
            attributes.text = this._processSyntax(attributes.text)
            return Backbone.Model.prototype.set.call(this, attributes, options)
        },

        sync: function() {
            $.post(Backbone.server_url + decodeURI(this.url()), {"text": this.get("text")})
        },

        _processSyntax: function(text) {
            var msg = text
            var host = meeting.get("host")
            var startAt = meeting.get("startAt") 

            if(host.name) {
                msg = msg.replace("##HOST", host.name)
                msg = msg.replace("##host", host.name)
            } else if(this.collection.host) {
                msg = msg.replace("##HOST", host.name)
                msg = msg.replace("##host", host.name)
            } else {
                msg = msg.replace("##HOST", "A friend")
                msg = msg.replace("##host", "A friend")
            }

            if(startAt){
                if(msg.indexOf("##DATETIME") > -1){
                    var utcStartAt = moment.utc(startAt)
                    msg = msg.replace("##DATETIME", utcStartAt.local().format("DD.MM HH:mm"))
                }   
            }

            if(meeting.get("guests")){
                var guests = meeting.get("guests")
                if(guests.length < 2){
                    msg = msg.replace("##GUESTS", "invited you")
                } else if(guests.length = 2){
                    msg = msg.replace("##GUESTS", "invited you and 1 other guest")
                } else {
                    var countOfOtherGuests = guests.length - 1
                    msg = msg.replace("##GUESTS", "invited you and " + countOfOtherGuests + " other guests")
                }
            }

            return msg
        }
    })

    var ChatMessageCollection = Backbone.Collection.extend({
        POLL_TIME: 10000, // CHECK FOR MESSAGE UPDATES
        model: ChatMessage,
        urlRoot: _.template("/web/meeting/<%- id %>/messages"),
        url: function() {
            return this.urlRoot({id: encodeURIComponent(this.meeting.id)}) + '?msisdn=' + $.cookie("msisdn")
        },

        comparator: function(message) {
            var date = moment(message.get("createdAt")).format("YYYY-MM-DD HH:mm:ss")
            var userId = message.get("user").id
            var text = message.get("text")
            return date + userId + text
        },

        initialize: function(models, options) {
            this.meeting = options.meeting
            this.host = options.meeting.get("host")
            this.fetch()
            this.localySendMessages = []
            this.__interval = setInterval(_.bind(function() {
                this.fetch({remove: false})
            }, this), this.POLL_TIME)
        },

        postMessage: function(message) {
            var createdAt = moment().tz("UTC").format("YYYY-MM-DD H:mm:ss")
            var now = new Date();
            var tempId = now.getTime()
            var msg = new ChatMessage({
                text: message,
                createdAt: createdAt,
                user: { status: "WEBUSER", id: $.cookie("userId") },
                tempId: tempId
            })
            this.add(msg)
            msg.sync()
            this.localySendMessages.push(msg)
        },

        getTempMessage: function(){
          return this.localySendMessages
        },

        confirm: function() {
            this.trigger("hide-messages")
            if(this.meeting) this.meeting.trigger("confirm")
        },

        cancel: function() {
            if(this.meeting) this.meeting.trigger("cancel")
        }
    })

    /* Views */
    var AuthenticationUI = Backbone.View.extend({
        tagName: "div",
        className: "treffn-authentication-ui",

        template: _.template(
                '<div class="main-container">' +
                    '<img src="image/logo.png" class="logo"/>' +
                    "<br/>" +
                    '<p>You\'ve been <span>invited</span> to a meeting.</p>' +
                    '<br/>' +
                    '<p>Please, input your phone number.</p>' +
                    '<div class="inputs">' +
                        '<form action="#">' +
                            '<input type="tel" class="messageBar" id="mobile-number" />' +
                            '<br/>' +
                            '<input type="text" class="messageBar" id="username" placeholder="nickname for chat" />' +
                            '<br/>' +
                            '<input class="sendBtn login" type="submit" value="send" />' +
                        '</form>' +
                    '</div>' +
                    '</div>'),

        initialize: function(options) {
            this.initCallback = options.initCallback
            var cookieMSISDN = $.cookie("msisdn")
            if(cookieMSISDN){
                this.hide()
            } else {
                this.render()    
            }
        },

        _bindEvents: function(){
            this.$("form").on("submit", _.bind(function(e) {
                e.preventDefault()
                var telInput = this.$("#mobile-number")
                if(telInput.val()){
                    var msisdn = telInput.intlTelInput("getNumber").replace(/\+/g, "")
                    var countryCode = telInput.intlTelInput("getSelectedCountryData").dialCode
                    $.cookie("msisdn", msisdn)
                    $.cookie("country-code", countryCode)
                    var username = this.$("#username").val()
                    this.model.set_username(username)
                    this.hide()
                } else {
                    alert("Bad input!")
                }
               
            }, this))
        },

        hide: function() {
            this.$el.hide()
            this.callback()
        },

        render: function() {
            this.$el.html(this.template())
            this._bindEvents()
            $("input,button").css("width",$(".main-container p").width())
        },

        callback: function() {
            this.initCallback()    
        }

    })

    var BottomBarUI = Backbone.View.extend({
        tagName: "div",
        className: "treffn-bottom-bar-ui",

        template: _.template(
                '<button class="btn arrowBtn predefined-messages esol_button1"></button>' +
                '<input type="text" class="messageBar" id="input-message" placeholder="Other Message" />' +
                '<button class="btn sendBtn esol_button" id="sendMessage">Send</button>'),

        initialize: function(options) {
            this.meeting = options.meeting
            this.messagesUI = options.messagesUI
            this.render()
        },

        _bindEvents: function() {
            this.$("#sendMessage").on("click touchstart", _.bind(function(e) {
               text = this.$("#input-message").val()
               if(text.trim()) {
                 this.model.postMessage(text)
                 this.$("#input-message").val("")
                 this.$("#input-message").focus()
               }
            }, this))

            this.$("#input-message").on("keyup", _.bind(function(e) {
                text = this.$("#input-message").val()
                if(!text || text.length <= 0 || text.trim().length <= 0){
                    if(this.$("#sendMessage").hasClass("enabled")){
                        this.$("#sendMessage").removeClass("enabled")
                    }
                } else {
                    if(!this.$("#sendMessage").hasClass("enabled")){
                        this.$("#sendMessage").addClass("enabled")
                    }
                }
            }, this))

            this.$("#input-message").on("keydown", _.bind(function(e) {
                if (e.keyCode == 13){
                  text = this.$("#input-message").val()
                  if(text.trim()) {
                    this.model.postMessage(text)
                    this.$("#input-message").val("")
                    this.$("#input-message").focus()
                  }
                }
            }, this))

            this.$("#input-message").on("click", _.bind(function(e) {
                this.messagesUI.showMessages()
            }, this))

            this.$(".predefined-messages").on("click touchstart", _.bind(function(e) {
                e.preventDefault()
                var modal = new MessageModal({
                    model: this.meeting,
                    messages: this.model
                })
                modal.render()
                this.messagesUI.showMessages()
            }, this))
        },

        hide: function() {
            this.$el.hide()
        },

        show: function() {
            this.$el.show()
        },

        render: function() {
            this.$el.append(this.template())
            this.show()
            this._bindEvents()
        }
    })

    var MessagingUI = Backbone.View.extend({
        tagName: "div",
        className: "chat",

        template: _.template(
                "<ul class='chat'>" +
                "</ul>"),
        initialize: function(options) {
            this.meeting = options.meeting
            var self = this
            setTimeout(function(){ self.render() }, 2000)
            this.hide()

            this.listenTo(this.model, "add", function() {
              var tempMessages = this.model.getTempMessage()
              for(var i = 0; i < tempMessages.length; i++){
                var id = tempMessages[i].tempId
                this.model.remove(tempMessages[i])
                $("#" + id).remove()
              }
              this.render()
              this._scrollToBottom()
            })
            this.listenTo(this.model, "change", function() {
               this.showMessages();
            })
            this.listenTo(this.model, "response", function() {
               this.render()
               this.$(".chat").focus()
            })
            this.listenTo(this.model, "hide-messages", function() {
               this.hideMessages()
            })
            this.listenTo(this.model, "show-input", function() {
               this.show()
               this._scrollToBottom()
            })

            // hide the messages list when user clicks on map or banner
            
            $("body").delegate("*", "click touchstart", function() {
               if($(this).is("#treffn-map") || $(this).is("#treffn-banner")) {
                 self.hideMessages()
               }
            })

        },

        _bindEvents: function() {
            this.$("form").on("submit", _.bind(function(e) {
               e.preventDefault()
               text = this.$(".input-message").val()
               if(text.trim()) {
                 this.model.postMessage(text)
                 this.$(".input-message").val("")
                 this.$(".input-message").focus()
               }
            }, this))

            this.$(".input-message").focus(_.bind(function(e) {
                this.showMessages()
            }, this))

            this.$(".predefined-messages").on("click touchstart", _.bind(function(e) {
                e.preventDefault()
                var modal = new MessageModal({
                    model: this.meeting,
                    messages: this.model
                })
                modal.render()
            }, this))
        },

        _scrollToBottom: function() {
            var list = this.$(".chat")
            list.scrollTop(list.prop("scrollHeight"))
        },

        hide: function() {
            this.$el.hide()
        },

        show: function() {
            this.$el.show()
        },

        hideMessages: function() {
            this.__hidden_msg = true
            this.hide()
        },

        showMessages: function() {
            this.__hidden_msg = false
            this.show()
        },

        render: function() {
            this.$el.html(this.template())
            this.messages = []
            this.model.forEach(function(m) {
                var msg = new MessageView({
                        el: this.$el.find(".chat"),
                        model: m })
                msg.render()
                this.messages.push(msg)
            }, this)
            //if(this.__hidden_msg) this.hideMessages()
            this._bindEvents()
        }
    })

    var MessageView = Backbone.View.extend({
        tagName: "div",
        className: "chatRow",
        templateMe: _.template(
          "<li class='guest' id='<%- tempId %>>'>" +
            "<div class='panel msg-panel'>" +
            "<div class='message'><%- text %></div>" +
              "<div class='timestamp'><%- time %></div>" +
            "</div>" +
          "</li>"),
        templateOthers: _.template(
          "<li class='host'>" +
            "<div class='esols_image'>" +  
              "<img src='<%- user_photo %>'>" +
            "</div>" +
            "<div class='esols_name'><%- user_name %></div>" +
            "<div class='panel msg-panel'>" +
              "<div class='message'><%- text %></div>" +
              "<div class='timestamp'><%- time %></div>" +
            "</div>" +
          "</li>"),
            
        _isGuest: function(user) {
          return user.status == "WEBUSER"
        },

        render: function() {
          var type = "host"
          var user = this.model.get("user")
          var userId = $.cookie("userId")
          var userPhoto = "./image/avatar.png"
          if(userId == user.id) {
            type = "guest"
            this.template = this.templateMe;
          } else {
            this.template = this.templateOthers;
          }
          if(user.photoPath){
            userPhoto = Backbone.server_url + user.photoPath;
          } 
          var time = moment.tz(this.model.get("createdAt"), "UTC")
          this.$el.append(this.template({
            time: time.clone().local().fromNow(),
            text: this.model.get("text"),
            user: type,
            user_photo: userPhoto,
            user_name: user.name,
            tempId: this.model.get("tempId")
          }))
        },
    })

    var MessageModal = Backbone.View.extend({
        tagName: "div",
        className: "treffn-message-modal modal fade",
        template: _.template(
            "<div class='modal-dialog'>" +
                "<div class='modal-content'>" +
                "<div class='modal-header'>Choose a message</div>" +
                "<div class='modal-body'>" +
                "<ul class='nav nav-pills nav-stacked'>" +
                    "<li><a href='#'>" +
                          "Delayed <%- eta1 %>" +
                    "</a></li>" +
                    "<li><a href='#'>" +
                          "Delayed <%- eta2 %>" +
                    "</a></li>" +
                    "<li><a class='cancel' href='#'>" +
                          "Sorry, can't make it" +
                    "</a></li>" +
                "</ul>" +
                "</div>" +
                "</div>" +
            "</div>"
        ),

        _getETA: function(extra) {
            var result = this.model.get("maproute.route")
            if(!result) return "time."
            var route = _.first(result.result.routes)
            if(!route) return "time."
            var leg = _.first(route.legs)
            var duration = Math.floor(leg.duration.value / 60.0)
            // round up to a multiple of 5
            if(duration % 5 != 0) duration = (duration - (duration % 5)) + 5
            var duration_text = moment.duration(duration + extra, "minutes").humanize()
            return duration_text
        },

        _bindEvents: function() {
            var self = this
            this.$(".nav-pills a").on("click touchstart", function(e) {
                e.preventDefault()
                if($(this).is(".cancel")) self.messages.cancel()
                self.messages.postMessage($(this).text())
                self.$el.modal("hide")
            })
        },

        initialize: function(options) {
            this.messages = options.messages
            this.$el.html(this.template({
                eta1: this._getETA(10),
                eta2: this._getETA(20),
            }))
            this.$el.attr("role", "dialog")
            this._bindEvents()
        },

        render: function() {
            this.$el.modal()
        }

    })

    var ResponseButtons = Backbone.View.extend({
        tagName: "div",
        className: "treffn-response-ui",

        template: _.template(
            '<div class="secondRow">' +
                '<button class="btn cancelBtn cancel"></button>' +
                '<button class="btn laterBtn cancel"></button>' +
                '<button class="btn backBtn confirm">I\'ll be there <%- eta_time %> </button>' +
            '</div>'),

        initialize: function(options) {
            if(options.messages) this.messages = options.messages
            this.$el.hide()
            this.listenTo(this.model, "change:status", this._checkStatus)
            this.listenTo(this.model, "change:maproute.route", this.render)
            this.listenTo(this.model, "confirm", this.hide)
        },

        _checkStatus: function() {
          var statuses = this.model.get("statuses")
          var userId = $.cookie("userId")
          if(statuses){
            for(i=0; i<statuses.length; i++){
              if(statuses[i].guestId == userId && statuses[i].status != this.model.STATES.OPEN_UNANSWERED){
                return
              }
            }
          }
          this.$el.show()
        },

        _getETA: function() {
            var result = this.model.get("maproute.route")
            if(!result) return "time."
            var route = _.first(result.result.routes)
            if(!route) return "time."
            var leg = _.first(route.legs)
            var duration = Math.floor(leg.duration.value / 60.0)
            // round up to a multiple of 5
            if(duration % 5 != 0) duration = (duration - (duration % 5)) + 5
            var startAt = this.messages.meeting.get("startAt")
            if(!(startAt instanceof Date)) startAt = moment(startAt, "YYYY-MM-DD HH:mm:ss").toDate()
            var now = new Date()
            var etaFromNow = new Date(now.getTime() + (duration * 60 * 1000))
            var duration_text
            var nt = etaFromNow.getTime() 
            var sat = startAt.getTime()
            if(nt <= sat){
                duration_text = "on time"
            } else {
                duration_text = "at " + moment(etaFromNow).format("HH:mm")
            }
            //duration_text = moment.duration(duration, "minutes").humanize()
            return duration_text
        },

        _bindEvents: function() {
            var self = this
            this.$(".confirm").on("click touchend", function(e) {
                e.preventDefault()
                self.hide()
                self.messages.postMessage($(this).text())
                self.messages.trigger("show-input")
                self.messages.confirm()
            })
            this.$(".cancel").on("click touchend", function(e) {
                self.hide()
                self.messages.trigger("show-input")
                self.messages.postMessage("I can't make it")
                self.messages.cancel()
                self.hide()
            })
            this.$(".change-message").on("click touchend", function(e) {
                self.hide()
                self.messages.trigger("show-input")
                self.messages.trigger("response")
            })
            this.$(".call-later").on("click touchend", function(e) {
                self.hide()
                self.messages.trigger("show-input")
                self.messages.postMessage("I will be late")
                self.hide()
            })
        },

        hide: function() {
            this.$el.hide()
        },

        render: function() {
            this.$el.html(this.template({eta_time: this._getETA()}))
            this._bindEvents()
        },
    })

    var NavigationPopup = Backbone.View.extend({
        tagName: "div",
        className: "treffn-navigation-popup marker",
        template: _.template(
            '<div class="message">' +
                '<img src="<%- user_photo  %>" class="face">' +
                '<p class="message-title"><b><%- name  %> invited you to <%- title %></b></p>' +
            '</div>' +
            '<div class="calendar">' +
                '<div class="date">' +
                    '<img class="icon_date" src="image/icon_date.png"/>' +
                    '<p class="date-p"><%- start_at %></p>' +
                '</div>' +
                '<div class="duration">' +
                    '<p class="duration-p"><%- duration %></p>' +
                    '<img class="icon_duration" src="image/icon_duration.png"/>' +
                '</div>' +
            '</div>' +
            '<div class="white-line"></div>' +
            '<div class="transports">' +
                '<div class="bicycling transportButton"><img class="icon_bicycle" src="image/icon_bicycle.png"><p><%- bicycling_eta %></p></div>' +
                '<div class="driving transportButton"><img class="icon_car" src="image/icon_car.png"><p><%- driving_eta %></p></div>' +
                '<div class="walking transportButton"><img class="icon_walker" src="image/icon_walker.png"><p><%- walking_eta %></p></div>' +
                '<div class="transit transportButton"><img class="icon_train" src="image/icon_train.png"><p><%- transit_eta %></p></div>' +
            '</div>'),

        initialize: function() {
            this.listenTo(this.model, "change:maproute", this.render)
            this.listenTo(this.model, "change:maproute.walking", this.render)
            this.listenTo(this.model, "change:maproute.driving", this.render)
            this.listenTo(this.model, "change:maproute.transit", this.render)
            this.listenTo(this.model, "change:maproute.bicycling", this.render)
        },

        _getETA: function(mode) {
            if(this._hasRoute(mode)) {
                var result = this.model.get("maproute."+mode)
                var route = _.first(result.result.routes)
                var leg = _.first(route.legs)
                var duration = moment.duration(leg.duration.value, "seconds")
                var duration_text = duration.format("h [H] mm [M]")

                return duration_text
            } else {
                return "N/A"
            }
        },

        _hasRoute: function(mode) {
            var result = this.model.get("maproute."+mode)
            if(!result) return false
            var route = _.first(result.result.routes)
            if(!route) return false
            else return true
        },

        _bindEvents: function() {
            var model = this.model
            this.$el.find(".transportButton").on("click touchstart", function(e) {
                e.preventDefault()
                e.stopPropagation()
                if($(this).is(".disabled")) return false

                if($(this).is(".walking"))
                    model.set("maproute", "walking")
                if($(this).is(".driving"))
                    model.set("maproute", "driving")
                if($(this).is(".transit"))
                    model.set("maproute", "transit")
                if($(this).is(".bicycling"))
                    model.set("maproute", "bicycling")

            })
        },

        render: function() {
            var name
            var userPhoto
            var jsonStartAt = this.model.get("startAt")
            var jsonEndAt = this.model.get("endAt")
            var startAt = moment.utc(jsonStartAt).local().format("ddd MMM DD HH:mm")
            var duration = moment.utc(moment(jsonEndAt).diff(moment(jsonStartAt))).format("H [H] m [Min]")
            if(this.model.get("host").name){
                name = this.model.get("host").name
            } else {
                name = "A friend"
            }
            if(this.model.get("host").photoPath){
                userPhoto = Backbone.server_url + this.model.get("host").photoPath;
            } else {
                userPhoto = "./image/avatar.png"; 
            }
            data = {
                title: this.model.get("title"),
                name: name,
                bicycling_eta: this._getETA("bicycling"),
                driving_eta: this._getETA("driving"),
                transit_eta: this._getETA("transit"),
                walking_eta: this._getETA("walking"),
                start_at: startAt,
                duration: duration,
                user_photo: userPhoto
            }
            this.$el.attr("id", this.id)
            this.$el.html(this.template(data))
            this._bindEvents()

            this.$el.find("."+this.model.get("maproute")).addClass("active")
            _.each(["bicycling", "driving", "transit", "walking"], function(mode) {
                if(!this._hasRoute(mode)) {
                    this.$("." + mode).addClass("disabled")
                }
            }, this)
        }
    })

    var MapButtons = Backbone.View.extend({
        tagName: "div",
        className: "treffn-map-buttons",
        template: _.template(
            '<div class="firstRow">' +
                '<button class="btn centerBtn"></button>' +
            '</div>'),

        initialize: function(options){
            this.render()
        },

        _bindEvents: function() {
            this.$(".centerBtn").on("click touchend", function(e){
                map.centerOnGuestCoords()
            })
        },

        render: function() {
            this.$el.html(this.template())
            this._bindEvents()
        }

    })

    var GoogleMap = Backbone.View.extend({
        tagName: "div",
        className: "treffn-meeting-map",
        travel_modes: google.maps.DirectionsTravelMode,
        DIRECTIONS_TIMEOUT: 1000,

        initialize: function() {
            this.listenTo(this.model, "change", this.render)
            this.listenTo(this.model, "confirm", this._fitBounds)

            //this.placeHostMark()
            //this.placeGuestMark()
        },

        _initGoogleMap: function() {
            var options = {
                zoom: 16,
                panControl: false,
                zoomControl: false,
                scaleControl: false,
                streetViewControl: false,
                overviewMapControl: false,
                mapTypeControl: false
            }

            this.map = new google.maps.Map(this.el, options)
            this.dservice = new google.maps.DirectionsService()
            this.drenderer= new google.maps.DirectionsRenderer({
                                    map: this.map,
                                    preserveViewport: true
                                })

            this.navpopup = new NavigationPopupMapsOverlay(this.map, this.model)

            this.host = new google.maps.Marker({
              position: this._getHostCoords(),
              map: this.map,
              icon: "image/B.png"
            })

            this.guest = new google.maps.Marker({
              position: this._getGuestCoords(),
              map: this.map,
              icon: "image/A.png"
            })
        },

        _getGuestCoords: function() {
            if(!this.model.get("guest.coords")) return
            return new google.maps.LatLng(this.model.get("guest.coords").latitude,
                                          this.model.get("guest.coords").longitude)
        },

        _getHostCoords: function() {
            return new google.maps.LatLng(this.model.get("latitude"),
                                           this.model.get("longitude"))
        },

        centerOnGuestCoords: function() {
            this.map.setCenter(this._getGuestCoords()) 
        },

        placeHostMark: function() {
            this.hostMark = new google.maps.Marker({
                position: this._getHostCoords(),
                map: this.map
            })
        },

        placeGuestMark: function() {
            this.guestMark = new google.maps.Marker({
                position: this._getGuestCoords(),
                map: this.map
            })
        },

        updateGuestMark: function() {
            if(this.guestMark) this.guestMark.setPosition(this._getGuestCoords())
        },

        renderDirections: function() {
            _.each(this.travel_modes, this._renderRoute, this)
        },

        _renderRoute: function(travelMode) {
            var options = {
                origin: this._getGuestCoords(),
                destination: this._getHostCoords(),
                travelMode: travelMode
            }
            this.dservice.route(options, _.bind(this._route_callback, this))
        },

        _route_callback: function(result, status) {
            var travelMode = undefined
            if(status == google.maps.DirectionsStatus.OK) {
               var info = result.mc || result.oc
               if(info) {
                 travelMode = info.travelMode.toLowerCase()
               } else {
                  travelMode = result.request.travelMode.toLowerCase()
               }
               if(travelMode == this.model.get("maproute")) {
                    this.drenderer.setDirections(result)
                    this.map.setCenter(this._getGuestCoords())
                    this.model.set("maproute.route",
                                   {result: result, status: status})
               }
            } else {
                console.warn("Could not find Google Maps route", arguments)
            }
            if(result && travelMode) {
                this.model.set("maproute." + travelMode,
                               {result: result, status: status})
                if(this.host || this.guest){
                  this.host.setMap(null)
                  this.guest.setMap(null)
                }
            }
        },

        _fitBounds: function() {
            var result = this.model.get("maproute.route")
            if(result && result.result)
                this.map.fitBounds(_.first(result.result.routes).bounds)
        },

        showDirections: function() {
            var delta = +(new Date()) - this.last_directons
            if(delta > this.DIRECTIONS_TIMEOUT || _.isNaN(delta)) {
                this.last_directons = +(new Date())
                this.renderDirections()
            } else {
                return false
            }
        },

        render: function() {
            if(!this.map && this.model.get("host") && this.model.get("guest.coords")) {
               this._initGoogleMap()
               this.map.setCenter(this._getGuestCoords())
            }
            if(this.map && this.model.get("guest.coords") &&
               this.model.get("latitude") && this.model.get("longitude")) {
               this.showDirections()
            }
            return this
        }
    })

    var NavigationPopupMapsOverlay = function(map, model) {
        this.model = model
        try {
          // XXX: For some reason it throws
          // Uncaught InvalidValueError: setMap: not an instance of Map
          // and not an instance of StreetViewPanorama
          // but works anyway
          this.setMap(map)
        } catch(e) {}
    }
    NavigationPopupMapsOverlay.prototype =  new google.maps.OverlayView()
    NavigationPopupMapsOverlay.prototype.onAdd = function(options) {
        this.node = document.createElement("div")
        this.view = new NavigationPopup({
            el: this.node,
            id: "treffn-popup",
            model: this.model
        })
        var panes = this.getPanes()
        panes.overlayMouseTarget.appendChild(this.node)
        this.view.render()
    }
    NavigationPopupMapsOverlay.prototype.draw = function() {
        var overlayProjection = this.getProjection()
        var latlng = new google.maps.LatLng(this.model.get("guest.coords").latitude,
                                            this.model.get("guest.coords").longitude)
        var sw = overlayProjection.fromLatLngToDivPixel(latlng)
        this.view.$el.css("left", sw.x - this.view.$el.width() / 2)
        this.view.$el.css("top", sw.y - this.view.$el.height() - 25)
        this.view.$el.show()
    }

    this.Treffn = {
        Profile: Profile,
        Meeting: Meeting,
        GoogleMap: GoogleMap,
        NavigationPopup: NavigationPopup,
        NavigationPopupMapsOverlay: NavigationPopupMapsOverlay,
        ResponseButtons: ResponseButtons,
        ChatMessageCollection: ChatMessageCollection,
        MessagingUI: MessagingUI,
        MessageModal: MessageModal,
        AuthenticationUI: AuthenticationUI,
        BottomBarUI: BottomBarUI,
        MapButtons: MapButtons
    }
})()
