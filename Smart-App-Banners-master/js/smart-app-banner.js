var origHtmlMargin = parseFloat($('html').css('margin-top'));

$(function() {      
  var iPad = navigator.userAgent.match(/iPad/i) != null; // Check if using an iPad
  var iPhone = true; // Check if using an iPhone
  //var iPhone = navigator.userAgent.match(/iPhone/i) != null; // Check if using an iPhone
  var safari = navigator.userAgent.match(/Safari/i) != null; // Check if using Safari

  var url = $('meta[name=banner-custom-url]').attr("content"); //Check if using custom banners URL
  var icon = $('meta[name=banner-custom-icon]').attr("content"); //Check if using custom banners Icon
  var appName = $('meta[name=banner-custom-name]').attr("content"); //Check if using custom banners App name
  var artistName = $('meta[name=banner-artist-name]').attr("content"); //Check if using custom banners Artist name

  if (navigator.userAgent.match('CriOS') && safari) { safari = false}; //Chrome is just a re-skinning of iOS WebKit UIWebView
  if ((iPad || iPhone) && (!safari)) {

    var banner = '<div class="smart-banner">';  
    banner += '<a href="#" id="swb-close">X</a>';
    banner += '<img src="' + icon + '" alt="" class="smart-glossy-icon" />';
    banner += '<div id="swb-info"><strong>' + appName + '</strong>';
    banner += '<span>' + artistName + '</span><br/>';
    banner += '<span>FREE</span></div>';
    banner += '<a href="' + url + '" id="swb-save">GET</a></div>';

    $('body').append(banner);    
    
    $('#swb-close').click(function(e){
      e.preventDefault();
      $('.smart-banner').stop().animate({top:'-82px'},300);
      $('html').animate({marginTop:origHtmlMargin},300);
    });
      
    $('.smart-banner').stop().animate({top:0},300);
    $('html').animate({marginTop:origHtmlMargin+78},300);  
  }      
});